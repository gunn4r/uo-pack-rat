# Gear Vault public-release audit (2026-09-12)

Read-only audit of what would break or embarrass a public GitHub release of the Gear Vault: `app/`, `scripts-legion/vault-scanner.py`, `scripts-legion/vault-refresh-claude.py`, `scripts-legion/vault-bridge.py`, `scripts/optimizer-core.ts`, `scripts/optimizer-core.test.mjs` (the runner depends on it), `scripts/test_runner.sh`, `TESTING.md`. Line numbers are as of this date. Nothing was modified.

Headline: the code itself is clean (no TODO/FIXME, no debug logging, no CRLF, no secrets), but the repo mixes code with one person's game data (fixtures, profiles, runs, bench results), every path is this machine's, the launcher and browser-open are macOS-only, the shard rules are compiled into the library and the page, and the local server accepts cross-origin POSTs that can write files and queue in-game item moves.

## 1. Hardcoded personal and machine paths (23)

| # | Where | What | Should become |
|---|---|---|---|
| 1.1 | `app/vault-server.mjs:31` | `PORT = process.env.VAULT_PORT \|\| 8765` | Keep the env var, add `--port`; 8765 is a fine default. |
| 1.2 | `app/vault-server.mjs:32` | `SCANS = <repo>/exports/scans` (or `app/fixtures` with `--demo`) | A data directory resolved once: `--data <dir>` > `GEAR_VAULT_DATA` > platform default (`app.getPath('userData')` under Electron; `~/.gear-vault` for the bare server). Scans live in `<data>/scans`. |
| 1.3 | `app/vault-server.mjs:33` | `PROFILES = app/data/profiles.json` (inside the code tree) | `<data>/profiles.json`. User data must not live next to shipped code. |
| 1.4 | `app/vault-server.mjs:34` | `BRIDGE = <repo>/exports/bridge` | `<data>/bridge`; the same path has to reach the Python scripts (see 1.13). |
| 1.5 | `app/vault-server.mjs:35` | `DEFAULT_PROFILES = app/data/profiles.default.json` | Ships with the app; fine, but with `characters: {}` (see 2.1). |
| 1.6 | `app/vault-server.mjs:36` | `RUNS = app/data/runs` | `<data>/runs`. |
| 1.7 | `app/vault-server.mjs:40` | `join(ROOT, "scripts", "optimizer-core.ts")` reaches outside `app/` | Move the core into the package (`app/optimizer-core.ts` or a real `.mjs` module, see 5.2) so `app/` is self-contained. |
| 1.8 | `app/vault-server.mjs:41`, `app/gear-vault.test.mjs:395-400`, `scripts/optimizer-core.test.mjs:27`, `app/bench/run-bench.mjs:68-71` | `mkdtempSync` in the OS temp dir, never removed | One loader helper; delete the temp dir on exit, or compile once to a cached file under `<data>`. |
| 1.9 | `app/vault-server.mjs:235,328` | `http://localhost:${PORT}` | Fine (URL base for parsing / the printed address). |
| 1.10 | `app/vault-server.mjs:327` | `listen(PORT, "127.0.0.1")` | Keep loopback-only as the default; expose a `--host` flag only deliberately (see 7.1). |
| 1.11 | `app/vault-server.mjs:330` | `spawn("open", [addr])` guarded by `process.platform === "darwin"` | Cross-platform opener (`open`/`xdg-open`/`start`) or print the URL and let the launcher open it (see 4.2). |
| 1.12 | `app/vault-server.mjs:2-4,13-14` (comments) | `exports/scans/*.json`, `optimizer-cli.mjs` | Rewrite for the data-dir model; `optimizer-cli.mjs` is not in the ship set. |
| 1.13 | `scripts-legion/vault-scanner.py:24`, `scripts-legion/vault-refresh-claude.py:30`, `scripts-legion/vault-bridge.py:18` | `os.path.expanduser(...)` pointed at `exports/...` under the original private workspace | One config lookup shared by the three scripts: read `<data>/config.json` (or a `GEAR_VAULT_DATA` env var; Legion exposes `os.environ`) with the app writing that file on first start; fall back to `~/.gear-vault`. Also fix the header comments at `vault-scanner.py:2,7`, `vault-refresh-claude.py:2,17`, `vault-bridge.py:3,8`. |
| 1.14 | `app/gear-vault.sh:6`, `scripts/test_runner.sh:8` | `$HOME/.nvm/versions/node/v24.15.0/bin/node` fallback | Delete the fallback; require `node` on PATH (document the version). |
| 1.15 | `app/gear-vault.sh:7` | `VAULT_PORT` default 8765 | Same as 1.1. |
| 1.16 | `scripts/test_runner.sh:2`, `TESTING.md:3` | reference `~/.claude/CLAUDE.md` | Drop; that is a private file. |
| 1.17 | `TESTING.md:24` | `~/Desktop/TazUO/TazUO/LegionScripts/` | Say "your TazUO `LegionScripts` folder". |
| 1.18 | `TESTING.md:26` | nvm path | Same as 1.14. |
| 1.19 | `app/CLAUDE.md:7,13,29,30,97` | port, `exports/scans`, `~/Desktop/TazUO`, `curl is blocked in this environment` | Not a shipping file as written (see 2.9); the successor doc describes the data dir. |
| 1.20 | `app/bench/run-bench.mjs:5`, `app/bench/gen-inventory.mjs:3,12`, `app/bench/README.md:5` | `exports/scans/` | Same data-dir resolution if the bench ships. |
| 1.21 | `uo-gear-vault.md:6-9` | `localhost:8765`, `./app/gear-vault.sh`, "nvm Node path baked in" | Design doc; only the README replaces it. |
| 1.22 | `app/gear-vault.html:383,628,714,...` | relative `fetch("/api/...")` | Fine: same-origin relative URLs survive any port. |
| 1.23 | `app/gear-vault.html:7-8` | `fonts.googleapis.com` stylesheet | Not a path, but a hard external dependency at every page load; either vendor the fonts or accept the system fallback offline (see 7.9). |

## 2. Personal data and names in shippable files (14)

Legend: **code** = ships as is, **data** = do not ship, must move to the data dir, **fixture** = ships only if synthetic.

| # | File | Status | Finding |
|---|---|---|---|
| 2.1 | `app/data/profiles.default.json` | code, needs editing | `characters` holds `Dorran` (l.25), `Rowan` (l.79), `Kestrel` (l.130) with their real floors, races and locked slots; the `_comment` (l.2) cites the private doc `uoalive-item-caps.md`. Ship `characters: {}` plus the four generic templates (`melee`, `caster`, `archer`, `tank` are fine) and `caps`; move the caps into the rules file (§3). |
| 2.2 | `app/data/profiles.json`, `app/data/profiles.backup-2026-09-11.json`, `app/data/profiles.backup-2026-09-12.json` | data | Live profiles for four characters (`Dorran, Rowan, Kestrel, Sable`) and a personal template named `Rowan`. |
| 2.3 | `app/data/runs/*.json` (29 files) | data | Each carries `character`, the chosen suit's item serials and names, settings and `inventoryStamp`. Characters present: Dorran, Rowan, Kestrel, Sable. |
| 2.4 | `app/fixtures/demo-Rowan.json` | fixture, **NOT synthetic** | 72 of its 80 item serials also appear in the real `exports/scans/*.json` files; it carries `character: "Rowan"`, a `position`, a real ground-chest serial and real tooltips. `app/CLAUDE.md` ("Synthetic scans built from the real Aug 26 2026 Rowan data") and `TESTING.md:15` ("synthesized") overstate it: it is a trimmed real scan. Regenerate it with `app/bench/gen-inventory.mjs` (which already learns the shape and mints fresh serials) under a fictional character name, without `position`. |
| 2.5 | `app/fixtures/demo-Dorran.json` | fixture, synthetic | One item plus three worn pieces, hand-made serials; only the character name is personal. Rename with 2.4. |
| 2.6 | `app/gear-vault.test.mjs:130-131,153-160,187-203,217-233,259-272,290-308,364-367,404-406` | code | Uses `Dorran`, `Rowan`, `Kestrel` as test character names. Harmless as test data but tied to the fixture names; rename together with 2.4/2.5 (e.g. `Alice`/`Bob`). |
| 2.7 | `app/bench/results/*.json`, `*.md` (4 files) | data | Timings computed on "real 459 items + synthetic" (`2026-09-12T23-18-11.md:1`); the JSON may embed pool sizes and names. Do not ship results; ship the bench scripts only if wanted. |
| 2.8 | `app/bench/run-bench.mjs:7,39,59-64` | code (optional) | Default `--profiles Dorran,Kestrel,Rowan-anyweapon` and the comment "the three real characters"; read profile names from the profiles file instead. |
| 2.9 | `app/CLAUDE.md` | data (dev notes) | Every section names the maintainer, session dates ("Sep 10 2026 lesson", "Sep 11 2026"), the house, characters, and private next-session plans (the market scanner). Distil the durable parts (files table, data model, fold rule, optimizer notes, bridge protocol, gotchas) into `ARCHITECTURE.md`/`CONTRIBUTING.md` with no names or dates. |
| 2.10 | `app/gear-vault.html:232` | code | Brand tagline "UO Alive · every piece, where it lives, what it does" and `:328` "(the Summoner must have zero Necromancy and Spirit Speak)" bake in the shard and one character's build; take the shard name from the rules file, make the tooltip generic. |
| 2.11 | `app/suit-optimizer.html:1101`, `app/template-builder.html:159` | legacy, do not ship | A `UOEXPORT|...|H^Dorran^100,100,25^523^...` sample and a "Dorran (live)" preset (see 5.3). |
| 2.12 | `exports/` (scans, bridge queue/status, logs) | data | Never ship; the bridge `queue.jsonl` holds 35 real commands with chest coordinates, `status.json` a character name. |
| 2.13 | `scripts-legion/vault-scanner.py:31`, `vault-refresh-claude.py:11-15,31` | code | Comments with private history ("probe-verified Aug 2026", the `__name__` investigation). Harmless but reads as a lab notebook; trim. |
| 2.14 | `app/vault-lib.mjs:7` | code | Comment references `suit-optimizer-claude.py`, a retired private script. |

## 3. Shard-specific constants (12)

Recommendation: one `rules/uoalive.json` shipped as the default and selected by `--rules`/profile field, loaded by the server, injected into the page (`/api/rules`) and passed to `effectiveProfile`. Everything OSI-standard (property tooltip wording, base item names, spell names, slayer names, meditation materials) stays in code with a rules-file override hook.

| # | Where | Constant | Verdict |
|---|---|---|---|
| 3.1 | `app/data/profiles.default.json` `caps` | resists 70, HCI/DCI 45, SSI 60, DI 100, LMC 40, LRC 100, FC 2, FCR 6, HPR 18, SR 24, HPI 25, MR 30, CF 12, SDI 100 | Rules file (`caps`). These are UO Alive's (`uoalive-item-caps.md`); OSI differs on several (LMC, HPR, SDI PvP). |
| 3.2 | `app/vault-lib.mjs:79-83` `resistSkillBonus` | `floor(0.4·min(skill,100) + 0.2·max(skill−100,0))` per resist | UO Alive-only (stock ServUO gives no resist from the skill). Rules file: `resistSkillBonus: {per100: 40, above100PerPoint: 0.2}` or null. Also the skill NAME `"Resisting Spells"` (l.81) must match the scanner's `SKILL_NAMES` and the client's naming. |
| 3.3 | `app/vault-lib.mjs:92-94` | resist cap 70, Elf energy 75 | OSI-standard, but belongs in rules (`resistCap`, `raceResistCaps`). The page repeats the numbers as prose at `gear-vault.html:302,684,863,1029` ("capped at 70", "+${rsb}"). |
| 3.4 | `app/vault-lib.mjs:100` `TAG_UNITS` | cursed 10, brittle 4, antique 1.5, prized 0.5, massive 0.5, unwieldy 0.5 | Antique/Brittle/Prized/Cursed are OSI item tags; Massive/Unwieldy are shard-specific negative tags (`uoalive-item-caps.md`). The unit values are one player's taste, not a rule: move the tag list to rules and the penalty weights into the template defaults. |
| 3.5 | `app/vault-lib.mjs:101` `RARITY_RE`; `app/gear-vault.html:368-370` `RARITY_RANK`/`RARITY_COLOR` | "Minor/Lesser/Greater/Major Magic Item", "Lesser..Legendary Artifact", "Reforged"; colours #a0a0a0…#FF8000 | UO Alive's loot-tier line and client colours; other ServUO shards have none or different names. Rules file (`rarityTiers: [{name, colour}]`). |
| 3.6 | `app/vault-lib.mjs:9-34` `PROP_PATTERNS` | 40 tooltip regexes | OSI/ServUO wording; keep in code. Nothing UO Alive-only is in the table (custom lines such as "Kinetic Eater 15%" fall through to `extras`, which is the right behaviour). Note `luck` is anchored (`^luck`) while the rest are not; `di` must stay after `sdi`. |
| 3.7 | `app/vault-lib.mjs:67-72` `SKILL_NAMES` | 58 lower-cased skill names, both "evaluating intelligence" and "evaluate intelligence", "bowcraft/fletching" | OSI; keep, allow rules-file additions. The scanner has its own Title-Case list (`vault-scanner.py:161-167`, TazUO's names, e.g. "Parry") — two lists that must agree on "Resisting Spells"; document that. |
| 3.8 | `app/vault-lib.mjs:178-183` `SPELL_NAMES` | Magery, Necro, Mysticism, Chivalry, Bushido, Ninjitsu, Spellweaving spell names (scroll detection) | OSI; keep. |
| 3.9 | `app/vault-lib.mjs:263` gargoyle rule; `buildPools:313` default `excludeGargoyle = true` | "Gargish …" name or "gargoyles only" flag; no elf-only filter at all | Encodes UO Alive's "elf gear is unrestricted, only gargoyle gear is race-locked". Rules file: `raceRestricted: ["gargoyle"]` (OSI would be `["elf", "gargoyle"]`), and the pool filter reads it. |
| 3.10 | `app/vault-lib.mjs:520-543` `medableOf` | material regexes (plate/chain/ring/bone/dragon/woodland/studded/metal/stone block; leather/hide/leaf/cloth allow), "mage armor", "spell channeling" | Stock ServUO `MeditationAllowance`; keep in code. |
| 3.11 | `app/vault-lib.mjs:147-164,474-494,506-509` name → slot, kinds, slayer aliases | UO base names, High Seas "doubloon", refinement names | OSI; keep. |
| 3.12 | free-skill list | none in `vault-lib.mjs`/`gear-vault.html` | Nothing to do (the 720-cap/free-skill logic never entered the app). |

## 4. Platform assumptions (9)

| # | Where | Assumption | Fix |
|---|---|---|---|
| 4.1 | `app/gear-vault.sh` (whole file) | bash, `pgrep -f`, `ps -o comm=`, `lsof -ti tcp:`, `kill -9`, fractional `sleep` | Replace with a Node launcher (`bin/gear-vault.mjs`: try to bind the port, tell the user who holds it, open the browser) exposed as `npm start`; never kill processes by name pattern in a shipped tool. |
| 4.2 | `app/vault-server.mjs:330` | `spawn("open")` only on darwin, silently nothing elsewhere | Platform switch (`open` / `xdg-open` / `cmd /c start ""`) in the launcher, or only print the URL. |
| 4.3 | `scripts/test_runner.sh:1-10` | bash + `mkdir -p` + heredoc piped into node | The logic is already JavaScript: move it to `scripts/test-runner.mjs` and keep a 2-line `.sh` shim; then `npm test` works on Windows. |
| 4.4 | `scripts/test_runner.sh:4`, `TESTING.md:26` | "Requires Node >= 22.6" for type stripping | Wrong: importing a `.ts` file without a flag needs Node >= 22.18 or >= 23.6 (22.6 only added `--experimental-strip-types`). State "Node 22.18+ / 24 LTS" and pin it in CI and `package.json` `engines`. |
| 4.5 | `vault-scanner.py:24`, `vault-refresh-claude.py:30`, `vault-bridge.py:18` | `os.path.expanduser(...)` pointed into the original private workspace | Works on Windows too, but the folder never exists there; see 1.13. TazUO is primarily a Windows client, so Windows is the common case for the scripts. |
| 4.6 | `vault-scanner.py:192,255`, `vault-refresh-claude.py:230` | `time.strftime` local time, no zone | See 6.2. |
| 4.7 | `vault-bridge.py:162-176` | byte-offset tailing of `queue.jsonl` | Portable (binary mode); fine. |
| 4.8 | line endings | No CRLF found in any shippable file | Add `.gitattributes` (`* text=auto eol=lf`) so Windows checkouts do not convert the `.py`/`.sh` files. |
| 4.9 | `app/gear-vault.html:7-8` | Google Fonts over the network | Offline the page falls back to the system stack silently; either vendor IBM Plex or state the fallback. |

## 5. Naming and hygiene (11)

| # | Item | Finding | Recommendation |
|---|---|---|---|
| 5.1 | `-claude` suffix | Only `scripts-legion/vault-refresh-claude.py` in the ship set (own header l.1; referenced `app/CLAUDE.md:35`). No TazUO macro references it (`Data/Profiles` grep is empty). `vault-lib.mjs:7`, `CLAUDE.md:116`, `uo-gear-vault.md:31,50` reference the retired `suit-optimizer-claude.py`. | Rename to `vault-refresh.py`; fix the comment at `vault-lib.mjs:7`. |
| 5.2 | Core loading trick | `scripts/optimizer-core.ts` has no exports by design (web-sandbox paste-ability, header l.4-6); four loaders append `export { … }` to a temp copy: `vault-server.mjs:39-46`, `gear-vault.test.mjs:395-400`, `optimizer-core.test.mjs:26-28`, `bench/run-bench.mjs:68-71`, each with its own export list. | The web client is legacy; make the core a normal module (`app/optimizer-core.ts` with `export`, or compiled `.mjs`), delete the four copies of the trick. If paste-ability must survive, one `load-core.mjs` helper and one export list. |
| 5.3 | Legacy pages | `app/suit-optimizer.html` (1141 lines) and `app/template-builder.html` (420) are not served by the server, not linked from `gear-vault.html`; referenced only by `scripts/README.md:25,27`, `scripts/gear-export.ts:7` and each other (`template-builder.html:131`). | Dead for the vault. Exclude from the public repo (or `legacy/` in the private one). |
| 5.4 | Test harness | `app/gear-vault.test.mjs` hand-rolled `test()`/`run()` with tags, console at l.603-604; `TESTING.md:15` and `app/CLAUDE.md` say 36 tests, the last summary says 37. | Keep (small, tag-driven, zero deps) or port to `node:test`; fix the count or stop stating it. |
| 5.5 | TODO/FIXME/debugger | None. | — |
| 5.6 | console output | `vault-server.mjs:63,152,219` (`console.error` on unreadable files), `:329` startup line; test file `:603-604`. | Fine. |
| 5.7 | Private-context comments | `vault-lib.mjs:7,79` ("shard rule"), `vault-scanner.py:31`, `vault-refresh-claude.py:11-15`, `bench/run-bench.mjs:59`, `vault-server.mjs:13-14` (`optimizer-cli.mjs`), all of `app/CLAUDE.md`. | Trim to what a stranger needs. |
| 5.8 | Duplicated helpers | `vault-refresh-claude.py:11-15,27+` copies the scanner's helpers verbatim because Legion's `__name__` is unverified; no `-quick.json` exists in `exports/scans` yet (no `meta` seen), so it is still unverified. | Resolve before release: run it once, then either import or keep a documented shared module. |
| 5.9 | Backups in the code tree | `app/data/profiles.backup-*.json` written by `vault-server.mjs:77-78` next to the code. | Goes away with the data dir. |
| 5.10 | Temp litter | `mkdtempSync` dirs (1.8) never deleted. | Clean on exit. |
| 5.11 | Repo scaffolding | No `README`, `LICENSE`, `package.json`, `.gitignore`, `.gitattributes`; the workspace is not a git repo. | All needed (see the file list). |

## 6. Contracts that become public API (5 schemas, 11 findings)

### 6.1 Scan snapshot (`vault-scanner.py:191-201`, read by `foldSnapshots` `vault-lib.mjs:213-254` and `enrich` `:256-268`)

```
{ version: 1,
  character: string,                      // fold: owner of the worn set; names starting "_" are tombstones (vault-lib:245)
  scannedAt: "YYYY-MM-DDTHH:MM:SS",       // LOCAL time, no zone; fold sorts by string (vault-lib:215)
  stats: {str, dex, int},                 // fold copies whole
  position: {x, y},                       // fold copies whole (no z, unlike roots[].pos)
  maxes: {hits, stam, mana},              // optional (absent in demo fixtures)
  resists: {phys, fire, cold, poison, energy},   // optional
  skills: {<Name>: {value, base, cap}},   // optional; fold reads skills["Resisting Spells"].value
  equipped: [item + layer: string],       // fold reads serial, layer, tooltip, name, graphic, hue, amount
  roots: [{serial: number, kind: "backpack"|"bank"|"ground", name}],   // fold reads serial only
  containers: {"<serial>": {serial, name, parent: number|null, root, kind: "backpack"|"bank"|"ground"|"bag", pos?: {x,y,z}|null, tooltip?: string[]}},
  items: [{serial, graphic, hue, amount, name, tooltip: string[], container: number}],
  meta?: {mode: "quick", name, roots}     // refresh script only; ignored by the fold
}
```

Findings:
- 6.1a `scannedAt` is local time without an offset, while the server's tombstone (`vault-server.mjs:314`) stamps UTC (`toISOString().slice(0,19)`). In a UTC+N zone a Forget sorts BEFORE any scan made in the previous N hours, so the scan wins and the forgotten container comes back; across DST changes ordering also flips. Fix: emit RFC 3339 with offset (or UTC) everywhere and bump `version`.
- 6.1b `containers` keys are strings, `items[].container` and `roots[].serial` are numbers; the fold coerces with `+` in several places (`:218,220,222,224,237`) but `inv.items` and `inv.containers` are keyed by whatever type came in. Document "serials are unsigned 32-bit integers, JSON numbers; object keys are their decimal strings".
- 6.1c `version` is written but never read; there is no rejection of unknown versions.
- 6.1d Items whose `container` is not under a listed root are silently dropped (`:239`); a nested bag with `parent == null` is treated as a root (`:228`). Document both.
- 6.1e `position` (top level) has `x,y`; `containers[].pos` has `x,y,z`. Unify.
- 6.1f `scannedAt` from the refresh script uses the same field, so a quick refresh and a full scan are indistinguishable except via `meta`; the fold does not read `meta`. Fine, but say so.

### 6.2 Bridge queue and status (`vault-server.mjs:291-308`, `vault-bridge.py:39-48,158-210`)

- Queue line: `{id: "<epochMs>-<rand>", action: "highlight"|"grab"|"goto", serial: number, name, chain: number[] (root … parent), pos: {x,y,z}|null, queuedAt: ISO-UTC, …any other key the page sent}` — the page also sends `location` (seen in the real queue); the server appends the body verbatim (6.2a: whitelist the keys).
- Status: `{alive: epoch seconds (float, 0 when stopped), character, current: {id, action, name}|null, results: {<id>: {ok, msg, t}} (last 30), counts: {done, failed}}`; the final write omits `current`. Server: `online = now − alive < 8 s`.
- 6.2b `alive` is seconds, `queuedAt` is ISO, run `createdAt` is ISO, `results[].t` is seconds: three time encodings across two files.

### 6.3 Profiles file (`profiles.default.json`, `migrateProfiles` `vault-lib.mjs:366-379`, `TEMPLATE_KEYS` `:358`)

```
{ _comment?, caps: {<prop>: number},
  characters: {<name>: {weights, floors, softFloors[], floorBonus, lockedSlots[], excludeTags[], excludeSkills[], excludeRoots?[], strLimit?, race: "human"|"elf"|"gargoyle"?, weaponSkill: string|null, allowOthersWorn, allowGargoyle, medOnly, template: string}},
  templates: {<name>: {the 11 TEMPLATE_KEYS}} }
```
- 6.3a No `version`; the migration is detected by the presence of `archetypes`/`archetype`. Add `version: 2` now so the next change has a hook.
- 6.3b `PUT /api/profiles` (`vault-server.mjs:244-249`) writes the body unvalidated; a malformed PUT bricks the file until hand-edited.

### 6.4 Saved run (`saveRun` `vault-server.mjs:223-232`, `runSummary` `runs-lib.mjs:30-38`)

`{id, key: sha1, character, createdAt: ISO-UTC, label, settings: {page snapshot: floors, softFloors, weights, lockedSlots, excludeTags, excludeRoots, strLimit, allowGargoyle, medOnly, weaponSkill, allowOthers, restarts, exact, budgetS}, inventoryStamp, poolSize, skipped: {counts}, opts, budgetMs, explored, result: {best, score, currentScore, greedyScore, delta, perSlotChanges, totals, seed, restarts, evaluations, method, proven?, nodes?, pruned?, alternatives?, altTolerance?, workers?}, ms}`
- 6.4a `settings.allowOthers` vs profile `allowOthersWorn` (`vault-lib.mjs:412` reads either) and `settings.budgetS` vs `budgetMs` are the same facts under two names. Pick one before the format is public.
- 6.4b `key` hashes `pools` and `current` (`runs-lib.mjs:17-19`), i.e. item serials, so runs are only reusable on the same shard/account; document that.
- 6.4c No `version`.

### 6.5 HTTP API (`vault-server.mjs:234-324`)

Every JSON reply is `{ok: boolean, …}`; errors are `{ok: false, error}` with a stack trace on 500 (`:322`). SSE events `hello`, `progress`, `ping`, `done`, `failed`, `cancelled` (`:202-212`). `GET /api/inventory` returns `scansDir`, a local path (`:241`). 6.5a: strip stacks and local paths from replies once `--host` exists.

## 7. Security and privacy (10)

| # | Finding | Where | Recommendation |
|---|---|---|---|
| 7.1 | Binds `127.0.0.1` only. Good. | `vault-server.mjs:327` | Keep; if `--host` is added, gate it behind a token. |
| 7.2 | **No origin/host check and no auth.** Any web page open in the same browser can send a simple cross-origin `POST` (a `text/plain` body is still `JSON.parse`d at `:94`) to `POST /api/forget` (writes a tombstone file that hides a container), `POST /api/bridge` (queues `grab` commands that `vault-bridge.py` executes in the game while it runs) and `POST /api/optimize` (spawns up to 8 worker threads per call, no queue limit). `PUT`/`DELETE` need a preflight and are not exposed this way. DNS rebinding widens it further since `Host` is never checked. | `vault-server.mjs:90-97,250,291,309` | Reject requests whose `Origin` is present and not `http://localhost:PORT`/`127.0.0.1:PORT`; check `Host`; or embed a per-start token in the page and require it on every write. Cap concurrent jobs. |
| 7.3 | Path handling: `/api/runs/<id>` is `[\w-]+` (`:269`), no traversal; `/api/forget` filenames are built from a UTC stamp and `(+root).toString(16)` (`:317`), no traversal, but a non-numeric `root` yields `…-NaN.json` with `serial: null`. | `:269,309-318` | Validate `root` as an integer. |
| 7.4 | `POST /api/bridge` appends the request body verbatim (any keys, up to 50 MB) to `queue.jsonl`; the bridge prints `name` in-game via `HeadMsg`. | `:293-297`, `vault-bridge.py:109,187` | Whitelist and bound the fields. |
| 7.5 | `PUT /api/profiles` writes unvalidated JSON (6.3b). | `:244-249` | Validate shape. |
| 7.6 | Shell-outs: only `open` (`:330`, darwin). `gear-vault.sh` kills every node process whose command line matches `vault-server.mjs` (`:12-22`) and whatever holds the port (`:25-28`). | | Drop the launcher (4.1). |
| 7.7 | Error bodies include stack traces and `scansDir` exposes a local path. | `:241,322` | Local-only today; tidy before any `--host`. |
| 7.8 | **What a scan file contains** (for the README): character name; the character's world position at scan time and the x,y,z of every scanned house container (so the house location); every item's serial (unique and permanent on the shard), graphic, hue, amount and full tooltip; stats, max hits/stam/mana, resists, and every skill value. A saved run adds the chosen serials and names; `status.json` adds the character running the bridge and timestamps; `profiles.json` adds character names and races. | `vault-scanner.py:191-201` | README section "What the files contain" plus a `.gitignore` for the data dir. |
| 7.9 | The page fetches Google Fonts on every load (a third-party request revealing the page is being used). | `gear-vault.html:7-8` | Vendor or drop (4.9). |
| 7.10 | The scripts are inventory-only (no combat/loot); the bridge `grab` moves items on the player's own account. | `vault-bridge.py:1-10` | State that plainly in the README; shard rules on assistants differ. |

## 8. Tests and CI readiness (7)

| # | Finding |
|---|---|
| 8.1 | `scripts/test_runner.sh:1-35`: bash wrapper, `set -u`, `cd` to the repo root, `mkdir -p test_logs`, then all logic in an inline Node ES module. No `date`, `jq`, `sed` or GNU-isms; the timestamp is `new Date().toISOString()`. Portable to Linux/macOS as is; Windows needs the `.mjs` split (4.3). |
| 8.2 | Modes: `--smoke` (tests tagged `smoke`), `--fast` (`fast` + `smoke`), full (everything plus `scripts/optimizer-core.test.mjs` spawned as one pass/fail unit). Summary written to `test_logs/latest_summary.json` in the required `{timestamp, mode, total, passed, failed, skipped, failures[{file,line,test_name,error}]}` shape; `line` is always 0. Last full run (2026-09-12T23:23:52Z): 37/37 passed. |
| 8.3 | Node requirement: the server, the test file and the harness import `optimizer-core.ts` through native type stripping, so CI needs Node 22.18+ or 24 (TESTING.md says 22.6, see 4.4). `SharedArrayBuffer`/`Atomics`/`worker_threads` are stock Node. Zero npm dependencies, so no install step. |
| 8.4 | The full suite depends on `app/fixtures/demo-*.json`; once the fixtures are regenerated (2.4) the expectations at `gear-vault.test.mjs:153-233` (item names such as "Katana", "Leather Gorget", worn counts) must be re-derived. |
| 8.5 | `test_runner.sh` writes into the repo (`test_logs/`); CI should upload it as an artifact and `.gitignore` it. |
| 8.6 | Runtime: brute-force checks over 150 + 60 + 80 random suits and the exact-search tests run inside the full mode; measure on a 2-core runner before setting a CI timeout (local full run takes seconds). |
| 8.7 | Proposed `.github/workflows/test.yml`: `ubuntu-latest`, `actions/setup-node@v4` with `node-version: 24`, `run: ./scripts/test_runner.sh`, `if: always()` upload `test_logs/latest_summary.json`; a second job `python -m py_compile legion/*.py` (the only offline check the Legion scripts have, `TESTING.md:24`). Add `package.json` with `"scripts": {"start": "node app/vault-server.mjs", "test": "./scripts/test_runner.sh"}` and `"engines": {"node": ">=22.18"}`. |

## Minimum viable public repo

Ship (code, after the edits above):
- `app/vault-server.mjs`, `app/vault-lib.mjs`, `app/gear-vault.html`, `app/optimize-worker.mjs`, `app/shared-search.mjs`, `app/runs-lib.mjs`
- `app/optimizer-core.ts` (moved from `scripts/`, exported as a module) and `app/optimizer-core.test.mjs` (moved from `scripts/`)
- `app/gear-vault.test.mjs`
- `app/data/profiles.default.json` with `characters: {}` and the four generic templates; `rules/uoalive.json` (caps, resist-skill formula, race caps, tags, rarity tiers, race-restricted gear)
- `legion/vault-scanner.py`, `legion/vault-refresh.py` (renamed), `legion/vault-bridge.py` (paths from config)
- `scripts/test-runner.mjs` + `scripts/test_runner.sh` shim; `TESTING.md` rewritten (no private paths, correct Node version, no test count)
- `bin/gear-vault.mjs` launcher replacing `app/gear-vault.sh`
- Optional: `app/bench/gen-inventory.mjs`, `app/bench/run-bench.mjs`, `app/bench/README.md` (without `results/`, profile names from the profiles file)

Ship (fixtures, regenerated synthetic): `app/fixtures/demo-<fictional names>.json` from `gen-inventory.mjs`, no `position`, fresh serials.

New: `README.md` (what it is, TazUO + Legion requirement, data dir, what the files contain, security note that the server is loopback-only and unauthenticated), `LICENSE`, `package.json`, `.gitignore` (`data/`, `test_logs/`, `*.backup-*.json`), `.gitattributes`, `ARCHITECTURE.md` distilled from `app/CLAUDE.md`, `.github/workflows/test.yml`.

Do not ship: `app/data/profiles.json`, `app/data/profiles.backup-*.json`, `app/data/runs/`, `app/bench/results/`, `app/fixtures/demo-Rowan.json` and `demo-Dorran.json` as they are, `app/CLAUDE.md` as written, `app/suit-optimizer.html`, `app/template-builder.html`, `exports/`, `test_logs/`, and everything else in the workspace (plans, wiki caches, the other Legion and web scripts).
