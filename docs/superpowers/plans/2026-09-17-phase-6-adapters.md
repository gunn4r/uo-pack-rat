# Phase 6 — Adapters and the Import Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach the players who do not use TazUO — a Razor Enhanced adapter with a scanner and a bridge, a ClassicUO web-client scanner whose output is pasted rather than written to disk, and the Import tab that receives that paste, imports scan files by hand, and rescans the inbox when the folder watcher misses something.

**Architecture:** Nothing about the scan or bridge schemas changes; only how bytes reach the data directory. Razor Enhanced is a second `"folder"` adapter, so it reuses the inbox watcher, the installer and the bridge queue unchanged. The web client cannot write files, so it prints a marked JSON block that the player copies into the Import tab, which writes it into the same inbox and lets the existing watcher do the rest. Every capability difference between clients is data — `capabilities.json` — and the page reads it to decide which buttons exist, rather than assuming every client can do what TazUO can.

**Tech Stack:** Node ≥ 22.18 and the existing zero-dependency server; IronPython 3.4 for Razor Enhanced (stdlib limited to `json`, `os`, `time`); TypeScript in the ClassicUO web client's script sandbox; the contract tests in `app/contracts.test.mjs`, which pick up a new adapter automatically.

**Spec:** `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md` — §3 (the rules that govern what may ship), §5.3 transports, §5.4 repo layout and shipping order, §11 edge cases, §12 phase 6.

## Global Constraints

- **The repository is public now.** Every push runs CI publicly at github.com/gunn4r/uo-pack-rat, and every commit is visible. Work on a branch named `phase-6-adapters`; never commit on `main`; the merge and any push to `main` are the user's decision.
- **Commits in this repository are authored as `gunn4r <2375148+gunn4r@users.noreply.github.com>`** — already set in the repo's git config. Do not change it, and do not add a `Co-Authored-By` line. Commit messages are imperative, bodies never hard-wrapped, and end with `Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb`.
- **`scripts/scrub.test.mjs` guards every tracked file.** Nothing may carry a private path, a real person's name, a real character name, or the retired product name. If something you write trips the guard, reword it — never edit the guard or its allow-lists.
- **Attended, inventory-only** (spec §3). Every script this phase adds reads what the character can already see, or moves one item when the player presses a button. No farming, no combat, no unattended loops. Each script's header and README says so.
- **Never ship a Stealth adapter, and never ship an Outlands adapter** (spec §3). Both are out of scope permanently, for shard-rule reasons the adapter guide states.
- **Python rules, both adapters:** no literal `while True` / `while (true)` / `while(true)` anywhere in a `.py` file, comments and strings included; adapter scripts are named `packrat-*.py` so the installer finds them; Razor Enhanced's IronPython 3.4 stdlib use stays within `json`, `os`, `time`.
- **Runtime dependencies stay at exactly one:** `highs` 1.15.3. Anything else is a devDependency pinned exactly.
- **Every new test carries a tag** (`[smoke]`, `[fast]`, `[slow]`) per `TESTING.md`.
- **Prose is never hard-wrapped** — one paragraph is one line, in every Markdown file this phase writes or edits.
- **Read results from `test_logs/latest_summary.json`**, never console output.
- **Never commit** `local/`, `app/dist/`, `test_logs/`, `.superpowers/`, `dist/`, `node_modules/`.
- **Never touch anything outside the repository** — not the maintainer's original private workspace, not their live game-client folder, not `~/.pack-rat` (their real data), not `~/.claude`. Each dispatch names those paths literally; the plan does not, because the plan is published.
- **Fixtures come from real runs, anonymised** (`docs/adapter-guide.md`'s Fixture rules, via `scripts/make-adapter-fixture.mjs`). A hand-written fixture is not acceptable; an adapter whose fixture cannot be produced yet ships without one and is skipped by the contract test until it can.

---

## File Structure

**Created:**

- `app/ui/import.mjs` — the Import tab: paste a scan, import files from a folder, rescan the inbox, and the result list.
- `adapters/razor-enhanced/packrat-scanner.py`, `packrat-bridge.py`, `capabilities.json`, `README.md`, `fixture.scan.json` — the Razor Enhanced adapter.
- `adapters/classicuo-web/packrat-scanner.ts`, `capabilities.json`, `README.md`, `fixture.scan.json` — the web-client scanner, paste transport.
- `app/import.mjs` — the server-side paste/import logic, pure enough to unit test (parse a pasted block, validate it, choose its inbox, write it atomically).
- `app/import.test.mjs` — its tests.

**Modified:**

- `app/vault-server.mjs` — `/api/import` generalised beyond the one hard-coded adapter, plus the paste and rescan routes.
- `app/index.html` — the Import tab button and section.
- `app/ui/app.mjs`, `app/ui/bridge.mjs`, `app/ui/wizard.mjs`, `app/ui/settings.mjs` — tab wiring, and capability-driven buttons so a client without a bridge does not show bridge controls.
- `app/installer.mjs` — more than one installable adapter: candidate client folders per adapter, and the wizard's choice of which to install.
- `app/server.test.mjs`, `app/installer.test.mjs`, `app/contracts.test.mjs` — coverage for the above.
- `.github/workflows/ci.yml` — compile every adapter's Python, not just one adapter's, under both interpreters where that is possible.
- `docs/adapter-guide.md` (paste transport becomes implemented), `docs/architecture.md`, `docs/scan-schema.md` if the capability shape changes, `README.md`, `TESTING.md`, `CHANGELOG.md`.

---

## Task 1: The Import tab — paste, file import, and rescan

Today `/api/import` copies `*.json` from a chosen folder into one hard-coded adapter's inbox, and there is no way to hand the app a scan the watcher never saw. This task makes importing a first-class path, which the paste transport in Task 3 then depends on.

**Files:**
- Create: `app/import.mjs`, `app/import.test.mjs`, `app/ui/import.mjs`
- Modify: `app/vault-server.mjs`, `app/index.html`, `app/ui/app.mjs`, `app/server.test.mjs`

**Interfaces:**
- Consumes: `app/config.mjs`'s `paths.inboxFor(id)`, `app/watcher.mjs`'s `scanOnce()`, `app/scan-schema.mjs`'s `upgradeScan`/`validateScan`.
- Produces, for later tasks: `POST /api/import/paste {text, adapter}` → `{ok, written, character, error?}`; `POST /api/import/rescan {}` → `{ok, adapters: [...]}`; `POST /api/import {dir, adapter?}` with the adapter defaulting to the existing behavior; and `parsePastedScan(text)` from `app/import.mjs`, which later tasks' tests reuse.

- [ ] **Step 1: Write the failing unit tests for the pure part**

Create `app/import.test.mjs` covering `parsePastedScan(text)`, which later accepts what the web-client script prints:

```js
test("[fast] parsePastedScan accepts a bare JSON document", () => { /* … */ });
test("[fast] parsePastedScan finds the document inside a marked block with log noise around it", () => { /* … */ });
test("[fast] parsePastedScan rejects text with no JSON, naming what it looked for", () => { /* … */ });
test("[fast] parsePastedScan rejects a document that is valid JSON but not a scan", () => { /* … */ });
test("[fast] parsePastedScan upgrades a v1 document the way the watcher does", () => { /* … */ });
```

Write the real assertions — a fixture document from `app/fixtures/` for the happy path, and a specific `error` string for each rejection. The markers the web script will print are `-----BEGIN PACK RAT SCAN-----` and `-----END PACK RAT SCAN-----`; a paste that includes them must work, and so must a paste of the JSON alone.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test app/import.test.mjs`
Expected: FAIL — `app/import.mjs` does not exist.

- [ ] **Step 3: Write `app/import.mjs`**

Export `parsePastedScan(text)` (find the block or take the whole text, `JSON.parse`, `upgradeScan`, `validateScan`, return `{ok, doc}` or `{ok: false, error}`) and `writeScanToInbox({doc, adapter, paths})` (atomic temp-then-rename into `paths.inboxFor(adapter)` under a name the watcher will accept, reusing the watcher's naming rule rather than inventing a second one — read `app/watcher.mjs`'s `acceptedName` and use it). Keep IO and parsing separate: the parse function takes and returns values only.

- [ ] **Step 4: Run them and watch them pass**

Run: `node --test app/import.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add the three routes**

In `app/vault-server.mjs`: `POST /api/import/paste {text, adapter}` (adapter must be a known adapter id — reuse the installer's existing adapter-id validation rather than writing a second one; reject anything else with 400), `POST /api/import/rescan {}` (call `scanOnce()` on every watcher, report which adapters were swept), and generalise `POST /api/import` to take an optional `adapter`, defaulting to today's behavior so nothing that calls it breaks. Every one of them nudges the watcher the way the existing import does, and the header comment block at the top of the file gets the new routes.

- [ ] **Step 6: Add route tests to `app/server.test.mjs`**

Follow the file's existing pattern (a real listening server on an ephemeral port, a temp data directory). Cover: a good paste lands a file that the watcher then ingests; a bad paste returns 400 with the parse error and writes nothing; an unknown adapter id is rejected; rescan reports the adapters it swept; and `POST /api/import` without an adapter behaves exactly as before. Tag them `[fast]`.

- [ ] **Step 7: Build the Import tab**

`app/index.html` gets a tab button and an `id="tab-import"` section, matching the existing tabs' markup exactly (read two of them first). `app/ui/import.mjs` renders: a textarea and a Paste scan button; an Import from folder control that reuses the host folder picker where available and falls back to a typed path on the bare server; a Rescan inbox button; and a result area that says what happened in a sentence a player understands — how many scans landed, or why one was refused. Wire it into `app/ui/app.mjs` the way the other tabs are wired, and reload the inventory on success through the existing events/reload path rather than a bespoke one.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`, then read `test_logs/latest_summary.json`.
Expected: 0 failed. Commit with a message describing the import paths and why they exist.

---

## Task 2: Capability-driven UI

TazUO can do everything; the web client cannot run a bridge at all, and Razor Enhanced's bridge may differ. The page currently assumes one client. This task makes the page read `capabilities` and show only what the player's client supports — required before an adapter that lacks a bridge can ship.

**Files:**
- Modify: `app/ui/bridge.mjs`, `app/ui/inventory.mjs` (or wherever the Highlight/Grab/Go-to buttons are rendered), `app/ui/settings.mjs`, `app/vault-server.mjs` if the capabilities are not already exposed to the page
- Test: `app/server.test.mjs`, and a UI-level check in `scripts/ui-smoke.test.mjs` if it can be made without brittleness

**Interfaces:**
- Consumes: `capabilities.json` per adapter; the `client` field in settings (`{adapter, scriptsDir} | null`) that Phase 4 added.
- Produces: whatever the page uses to decide — document it in `docs/architecture.md`.

- [ ] **Step 1: Find out what the page already knows**

Read `app/ui/bridge.mjs`, the inventory table's action buttons, and the settings/`/api/settings` shape. Establish where the current adapter id is known on the page and whether its capabilities are reachable. Write down what you found before changing anything; the design of this task depends on it.

- [ ] **Step 2: Write the failing test**

Add a `[fast]` route test: with settings naming an adapter whose capabilities declare no bridge, the endpoint the page reads reports no bridge actions; with TazUO, it reports the three. If capabilities are not currently served to the page, this is the test for the new field.

- [ ] **Step 3: Run it, watch it fail, then implement**

Serve the capabilities (or the derived flags) and have `app/ui/bridge.mjs` hide or disable the bridge controls when the current adapter has none, with a one-line explanation in the UI rather than a silently missing button — a player whose client cannot do it should learn why.

- [ ] **Step 4: Full suite, then commit**

---

## Task 3: The ClassicUO web-client scanner (paste transport)

The web client's script sandbox cannot write files, so the scanner prints a marked block the player copies into Task 1's Import tab. The sandbox also has a CPU watchdog that kills scripts for sustained compute, so the scan loop must be paced.

**Files:**
- Create: `adapters/classicuo-web/packrat-scanner.ts`, `adapters/classicuo-web/capabilities.json`, `adapters/classicuo-web/README.md`
- Modify: `docs/adapter-guide.md` (paste transport moves from roadmap to implemented), `README.md`

**Interfaces:**
- Consumes: the scan schema (`docs/scan-schema.md`), and Task 1's paste markers.
- Produces: `adapters/classicuo-web/capabilities.json` with `transport: "paste"`, `bridge: []`, and honest values for what the web client cannot see.

- [ ] **Step 1: Establish what the web client can actually do**

The scan schema's `capabilities` block must tell the truth about this client. Research the ClassicUO web scripting API before writing anything, and record in the README what you relied on. Known constraints from the reference implementation's history, which you must verify rather than assume: the equipped arms layer is not readable there; the bank box has no world handle, so bank contents cannot be scanned; a container's contents can throw on a locked or trapped container and must be wrapped; item names are unreliable from the object handle and should come from the tooltip query; and heavy loops get killed by the sandbox's CPU watchdog, so the scan must yield.

- [ ] **Step 2: Write `capabilities.json` first**

It is the contract: `{adapter: "classicuo-web", version, transport: "paste", capabilities: {layers, arms, bank, ground, nested, tooltips, bridge: []}}`. Set `arms` and `bank` to what Step 1 established. The scanner's own capabilities constant must match this file byte-for-byte in content — the contract test compares them.

- [ ] **Step 3: Write the scanner**

It walks the equipped layers, the backpack and its nested bags, and reachable ground containers; it queries tooltips rather than trusting names; it wraps every container-contents read in try/catch; it paces itself so the sandbox does not kill it; and it prints one JSON document between `-----BEGIN PACK RAT SCAN-----` and `-----END PACK RAT SCAN-----`. Its header states, in the first lines, that it is attended and inventory-only. Emit a schema-valid v2 document directly — no v1, since this adapter is new.

- [ ] **Step 4: Prove the output validates without a game client**

You cannot run the web client here. Instead, make the script's document shape checkable: add a `[fast]` test that takes a sample document committed under `app/fixtures/` (or built by the test from the schema) and asserts `validateScan` accepts it, and hand-check the scanner's emitted shape against `docs/scan-schema.md` field by field, recording the check in your report. Do not claim the scanner works; claim only what you verified.

- [ ] **Step 5: Write the README**

For a player: where the script goes, what to press, what to copy, where to paste it, and what this client cannot see (the bank, the arms layer, and no in-game Highlight/Grab/Go-to buttons because there is no bridge). State that the fixture and live verification are still outstanding.

- [ ] **Step 6: Full suite, then commit**

Note in the commit body that the adapter ships without `fixture.scan.json`, so the contract test skips it until a real run produces one (Task 6).

---

## Task 4: The Razor Enhanced adapter

Razor Enhanced is Windows-only, runs IronPython 3.4, and is what the shard officially distributes — the largest group of players this app cannot currently serve. It writes files, so it is a second `"folder"` adapter and reuses the watcher, the installer and the bridge queue unchanged.

**Files:**
- Create: `adapters/razor-enhanced/packrat-scanner.py`, `adapters/razor-enhanced/packrat-bridge.py`, `adapters/razor-enhanced/capabilities.json`, `adapters/razor-enhanced/README.md`
- Modify: `.github/workflows/ci.yml` (compile every adapter's Python, not one adapter's by name), `docs/adapter-guide.md`, `README.md`

**Interfaces:**
- Consumes: the scan schema, the bridge protocol (`docs/bridge-protocol.md`), and the same data-directory resolution the TazUO scripts use (`packrat-paths.json` beside the script → `PACKRAT_DATA` → `~/.pack-rat`), so the installer works unchanged.
- Produces: `adapters/razor-enhanced/capabilities.json` with `transport: "folder"` and its real capability set.

- [ ] **Step 1: Research the Razor Enhanced API before writing code**

Use its official documentation. Establish, and record in your report with a citation for each: how to enumerate equipped layers, how to read a container's contents and whether the container must be opened first, how to read item properties/tooltips, how to read player stats, skills and resists, and what the API offers for the three bridge actions (highlight, grab, go to). Where the API cannot do something, that is a `false` in `capabilities.json`, not a workaround.

- [ ] **Step 2: Write `capabilities.json`**

Honest values from Step 1. If Razor Enhanced cannot do one of the three bridge actions, `bridge` lists only what it can.

- [ ] **Step 3: Write the scanner**

Structure it after `adapters/tazuo/packrat-scanner.py` — read that first — with the same data-directory resolution, the same atomic temp-then-rename write into `<data>/inbox/razor-enhanced/`, the same raw-tooltip philosophy (dump what the client gives, let the app parse), and a `CAPABILITIES` constant matching `capabilities.json`. IronPython 3.4: standard library limited to `json`, `os`, `time`. No literal `while True` anywhere.

- [ ] **Step 4: Write the bridge**

Follow `docs/bridge-protocol.md` and `adapters/tazuo/packrat-bridge.py`: read commands from `<data>/bridge/razor-enhanced/`, perform only the actions `capabilities.json` claims, write results back, and refuse an unknown action rather than guessing. One item at a time, attended, on a button press.

- [ ] **Step 5: Compile both under Python 3**

Run: `python3 -m py_compile adapters/razor-enhanced/packrat-*.py`
Expected: clean. This proves syntax only — IronPython 3.4 is not Python 3.12, so also check by eye that nothing uses a syntax or stdlib feature newer than 3.4, and say in your report what you checked.

- [ ] **Step 6: Generalise the CI Python step**

`.github/workflows/ci.yml` names one adapter's scripts explicitly. Make it compile every `adapters/*/packrat-*.py`, so a future adapter is covered without editing the workflow, and extend the packaging test that guards the workflow accordingly.

- [ ] **Step 7: Write the README and commit**

Install steps for a Windows player (where Razor Enhanced keeps its scripts folder), what to press, the limits, and that live verification is pending. Note in the commit body that the adapter ships without a fixture until Task 6.

---

## Task 5: Installer and wizard for more than one client

The setup wizard installs "the adapter"; with three adapters, the player has to say which client they use, and the installer has to look in the right places for it.

**Files:**
- Modify: `app/installer.mjs`, `app/ui/wizard.mjs`, `app/ui/settings.mjs`, `app/vault-server.mjs` if the setup routes need the adapter id
- Test: `app/installer.test.mjs`, `app/server.test.mjs`

**Interfaces:**
- Consumes: `listAdapters()`, `candidateClientRoots()`, `installScripts()` from `app/installer.mjs`; `capabilities.json` per adapter for what to tell the player.
- Produces: setup routes that take an adapter id; settings' `client.adapter` reflecting the chosen one.

- [ ] **Step 1: Read what exists**

`app/installer.mjs` in full, plus `app/ui/wizard.mjs`. Establish where the single adapter is assumed — the candidate folders, the install target, the running-script guard, the settings shape — and list those places before changing them.

- [ ] **Step 2: Write the failing tests**

In `app/installer.test.mjs`: candidate roots are per adapter and a Razor Enhanced root is proposed on Windows-shaped paths; installing adapter A never copies adapter B's scripts; the adapter-id validation still rejects traversal and unknown ids (that test exists — extend it, do not duplicate it); a paste-transport adapter is not offered for installation at all, since it has no scripts to install.

- [ ] **Step 3: Run them, watch them fail, implement, watch them pass**

- [ ] **Step 4: The wizard asks which client**

The first-run wizard offers the installable adapters by name, with one line each about what that client can do, and installs the chosen one. A player on the web client picks it and is sent to the Import tab instead of a scripts folder. Settings shows the current choice and allows changing it.

- [ ] **Step 5: Full suite, then commit**

---

## Task 6: Live verification and fixtures (needs the user)

Neither new adapter can be verified from a development machine. This task is the checklist the user works through, and the work that follows from what they send back. It is the last task; everything before it must be merged-ready without it.

**Files:**
- Create: `adapters/razor-enhanced/fixture.scan.json`, `adapters/classicuo-web/fixture.scan.json`
- Modify: the adapters' READMEs (remove the "not yet verified" notices as each is confirmed), `CHANGELOG.md`

- [ ] **Step 1: Write the verification checklist for the user**

A short document in the branch (or the task report) telling the user exactly what to do on Windows for Razor Enhanced and in the web client: install, run, what should appear, and what file or text to send back. Include what a failure looks like so they can report it usefully.

- [ ] **Step 2: Razor Enhanced, on real Windows**

The user runs the scanner. The scan file comes back. Check it validates (`validateScan`), folds (a character with nested containers and worn items), and that its `adapter.capabilities` matches `capabilities.json`. Fix whatever the real run exposes — this is where the API research meets reality, and finding differences is the expected outcome, not a failure.

- [ ] **Step 3: Generate the Razor Enhanced fixture**

Run: `node scripts/make-adapter-fixture.mjs <the real scan> adapters/razor-enhanced/fixture.scan.json`
Then verify by eye per `docs/adapter-guide.md`'s Fixture rules: no real character name, no real crafter or engraving text, positions and serials remapped. The contract test then picks the adapter up automatically.

- [ ] **Step 4: The web client, the same way**

Run the script, paste the block into the Import tab, confirm the scan lands and folds, fix what reality exposes, and generate that fixture from the resulting scan.

- [ ] **Step 5: Bridge verification**

With Razor Enhanced running its bridge, press Highlight, Grab and Go to in the app for one item each, and confirm what happens in the client. Any action the client cannot really do gets removed from `capabilities.json`, not left aspirational.

- [ ] **Step 6: Documentation and CHANGELOG, then commit**

Remove the pending-verification notices for whatever was confirmed, leave them for whatever was not, and record honestly in the CHANGELOG which adapters are verified live and which are not.

---

## Self-Review

**Spec coverage:** §5.4's shipping order (TazUO, then Razor Enhanced, then the web client) — Tasks 4 and 3. §5.3's paste transport — Tasks 1 and 3. The Import tab, and the manual rescan that §11 names as the answer to a watcher that misses events on Windows — Task 1. The capability differences between clients becoming data rather than assumptions — Task 2. Multi-adapter installation — Task 5. Real fixtures per the adapter guide — Task 6.

**Deliberately out of scope:** the HTTP-to-localhost transport (still roadmap, no adapter needs it yet), the ClassicAssist adapter, a Stealth adapter (never), an Outlands adapter (never), and signing or an application icon, which remain Phase 5's carried pre-1.0 items in `RELEASING.md`.

**Known risk:** Tasks 3 and 4 write client code that cannot be executed here, against APIs the implementer must research rather than recall. The plan's answer is that each task states what it verified and what it did not, each adapter ships without a fixture until a real run produces one, and Task 6 is where reality corrects the research. An implementer who reports an unverifiable claim as verified is the failure mode to watch for in review.
