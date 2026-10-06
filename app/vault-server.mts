// vault-server.mts — Pack Rat local server. No npm imports of its own (the one runtime dependency, HiGHS, is loaded in the optimize worker, through app/mip-solve.mts).
//   node app/vault-server.mts [--data <dir>] [--port N] [--demo] [--open]
// Exports startServer(config) → { server, port, url, close() } — nothing runs at import time, so a
// test (or another launcher) can start and stop as many independent instances as it likes. The file
// also self-starts when run directly (node app/vault-server.mts / node scripts/start.mts).
// Routes: GET /  (index.html) · GET /favicon.png (app/assets/, the logo at 64 px) · GET /logo-mark.png (the rat's head cropped from the logo, 80 px, the sidebar's mark) · GET /vault-lib.mjs · GET /item-query.mjs (pure filter/sort/facet logic
//         shared by the browser and GET /api/items below — no DOM, no node: imports, servable byte for
//         byte like vault-lib.mts) · GET /scan-schema.mjs (vault-lib.mts imports it for parseStamp, so
//         it must be servable to the browser the same way) ·
//         GET /schema/validate.mjs (scan-schema.mts's own import, same reason) · GET /organize-config.mjs (the rule editor's import, same reason) · GET /buffs.mjs (the Suit Builder's Manual buffs, same reason) · GET /data-dir-notice.mjs (ui/messages.mts's import, same reason) ·
//         GET /ui/<name> (name matching /^[a-z0-9-]+\.(mjs|css)$/, served from app/ui/, else 404) ·
//         GET /ui/fonts/<name>.woff2 (the bundled IBM Plex faces, app/ui/fonts/, as binary font/woff2) ·
//         GET /api/inventory (the cached fold of every scan, with Organize's results overlay applied —
//         getInventory(), keyed by a signature of the scans directory + shard, and of
//         organize-state.json for the overlay, so an edited/added/removed scan file or a finished trip is
//         picked up on the next request with no restart; each scan file is upgraded v1→v2 and schema-
//         validated on read — scanStore.all() — an invalid or unparsable file is logged and skipped) — the
//         response carries facets/worn/rootCounts/missingCounts/itemCount/propKeys — never the full item map
//         (that stopped shipping in Task 5, once the page moved to paging GET /api/items instead) ·
//         GET /api/missing?root= — what left that root since its last scan (app/missing.mts, issue #99)
//         GET /api/items?q=&slot=&loc=&rarity=&kind=&seenDays=&slayer=&nogarg=&med=&hide=&prop=&group=
//         &sort=&dir=&offset=&limit= — a paged, server-side search/sort over the same folded inventory
//         (parseItemQuery/applyItemQuery, app/item-query.mts); &fields=hits answers lean rows (hitRow), up to
//         HIT_LIMIT a page, for the House map's search ·
//         GET /api/items/by-serial?serials=1,2,3 — full item records (location/tags/equippedBy…) by
//         serial, 1-200 at a time (400 otherwise); a serial with no item is simply absent from the
//         response · GET|PUT /api/profiles (<data>/profiles.json)
//         GET|PUT /api/settings (<data>/settings.json: {shard, setupDone?, client?, retention?, autoUpdateCheck?, uoFolder?}) ·
//         GET|PUT /api/tazuo-panel ({hotkey?, showAtLogin?} -> {prefs}: the TazUO panel's hotkey and whether it
//         shows its window at login, <data>/tazuo-panel.json, app/tazuo-panel.mts) ·
//         POST /api/retention/cleanup {dryRun} -> {scans, runs, refused} (prune old scans and saved runs
//         now, or count what that would remove; app/retention.mts; 409 under --demo) · GET /api/rules (the current shard's
//         rules object plus every {id,name,source} listRules() finds — builtin and <data>/rules/*.json)
//         POST /api/optimize {pools,current,profile,opts} -> {id}, or {character,settings,profile,opts}
//         to have the server build the pools itself (buildPools, per-slot lockedSlots/blocked handling —
//         see the route below; with `pinned`, Manual's suit {slot: serial}, it fills only the empty slots, for a
//         character or none, and is never saved as a run); either form's response carries poolSize/skipped/current/blocked/warning?
//         GET /api/optimize/<id>/events (SSE: hello, progress, done|failed|cancelled) ·
//         POST /api/optimize/<id>/cancel · GET /api/optimize/<id>/status
//         A request whose inputs match a saved run that cannot be bettered returns {cached: true, run} at once.
//         GET /api/runs?character= (saved runs, newest first) · GET|PUT {label}|DELETE /api/runs/<id> ·
//         POST /api/runs {character, suit, settings, inventoryStamp} (save Manual's suit as a run, method "manual")
//         POST /api/forget {root} (drop a container from the inventory: writes a tombstone scan;
//         409 under --demo, which must never write into the committed app/fixtures/) ·
//         POST /api/forget-character {character} (drop a character's card, worn set, backpack and bank:
//         a `_vault` tombstone carrying forgetCharacter; 409 under --demo) ·
//         GET|POST {serial, name, where?} /api/blacklist · DELETE /api/blacklist/<serial>
//         (<data>/scan-blacklist.json, the containers scans never open) ·
//         GET|POST {name?, graphic?, kind} /api/item-kinds · POST /api/item-kinds/import {names?, graphics?}
//         (<data>/item-kinds.json, the player's own item kinds: app/item-kinds.mts; kind null resets, an import merges) ·
//         GET /api/houses (the houses scans captured: app/house-capture.mts, each with its container serials; tiledataFrom says where tiledata.mul came from, or why there is none) · GET /api/houses/<id> (one house's model: app/house-model.mts, tiledata.mul via app/tiledata.mts or the uoFolder setting) ·
//         GET /api/facet-map/<facet>.png?x0&y0&x1&y1&w (x-region: the region drawn, slid inside the facet; a facet overview from the same UO folder's facetNN.mul: app/facet-map.mts, app/png.mts; 404 {reason} when there is none) ·
//         GET /api/house-map · PUT /api/house-map/<id> {name, bounds?, areas?} (<data>/house-map.json, the player's house names and drawn areas: app/house-names.mts;
//         an empty name with no areas removes the entry; 400 on a bad name, area or id, 409 when a change would grow it past 500 names or 1 MB) ·
//         GET|PUT /api/organize (<data>/organize.json, Organize's labels, rules, catch-all and pinned items: app/organize-config.mts;
//         GET salvages a hand-edited file and lists what it dropped in `problems`) ·
//         GET /api/organize/presets (app/organize-presets.mts's PRESETS, the rule filters the Organize page offers
//         to start a rule from; read-only) ·
//         POST /api/organize/match {match} -> {count, pieces, sample} (the movable items in labelled roots that one
//         rule filter takes, ignoring the other rules: the rule editor's live count; read-only) ·
//         POST /api/organize/propose {strategy: "simple"|"detailed"|"build", containers?: [serial…]} -> {proposal} (Auto
//         organize: app/organize-strategies.mts's proposeOrganize over the ticked ground chests, or every one it ticks
//         by default; the proposal carries the whole next setup, which the page saves with PUT /api/organize;
//         read-only; 409 when organize.json needed salvage or the proposal would not save) ·
//         GET /api/organize/plan (app/organize.mts's planOrganize over the fold, organize.json, the blacklist and the
//         results overlay <data>/organize-state.json, after reading finished trips out of the bridge's status.json;
//         `running` = {id, index, queuedAt, picked} for the trip not reported back yet, or null) ·
//         POST /api/organize/trip {index, stamp} (queues that trip of the CURRENT plan with app/bridge-trip.mts's
//         queueTrip; 409 when the client's bridge has no "trip", organize.json needed salvage, a trip has not reported
//         back (while its bridge's heartbeat is fresh), stamp is not the plan's, or the trip is not its site's first) ·
//         Put away (issue #131; no route: the TazUO panel drops inbox/<adapter>/putaway-request.json, the watcher hands it
//         to putAway, which queues the first trip of the plan for the container the player picked like POST /api/organize/trip
//         and answers in bridge/<adapter>/putaway.json; app/put-away.mts) ·
//         GET|PUT /api/ui-prefs (<data>/ui-prefs.json: {cols?, colsVersion?, colWidths?, sheetProps?, theme?, appearance?, sidebar?, density?, areaLabels?, mapDrawerWidth?, builderMode?, manualFor?, manualSuit?, manualBuffs?, autoBuffs?, buffSkills?, buffsCount?, dismissedUpdate?, copiedScanner?}, the page's view choices)
//         GET /api/mcp -> {config: {enabled, allowActions, port, token}, live: {listening, port, portBusy}} · PUT /api/mcp {enabled?, allowActions?}
//         · POST /api/mcp/token {} (rotate) — the built-in MCP server's settings (<data>/mcp.json, app/mcp.mts; it listens on its own port)
//         POST /api/bridge {action, serial, name, chain: [root…parent], pos|null} (queue for packrat-bridge.py) · GET /api/bridge/status · POST /api/bridge/stop {} (Organize's Stop: writes <data>/bridge/stop, which packrat-bridge.py checks between a trip's steps)
//         GET /api/events — SSE, one stream shared by every connected client (not per-job like the
//         optimize events above): hello {ok, watching: [adapter ids]} on connect, inventory
//         {file, character, scannedAt, at} once an inbox file is accepted into paths.scans, rejected
//         {file, reason, at} once one is moved to its adapter's rejected/ folder, changed {what:
//         "inventory"|"runs", by?, at} (by: the forgetting tab's x-client-id) after a forget, forget-character, run deletion or retention prune (so other open tabs
//         reload), ping every 15s. A
//         normal token-protected /api/* route (no SSE exemption — unlike /api/optimize/<id>/events,
//         this stream carries no per-job secret an EventSource couldn't send anyway). Non-demo mode
//         starts one app/watcher.mts per adapters/<id>/ directory that ships a capabilities.json
//         (today: tazuo, razor-enhanced and classicuo-web), watching paths.inboxFor(id) and normalising accepted files into
//         paths.scans; --demo starts none (paths.scans there is the committed app/fixtures/, which
//         must never be written to).
//         Setup wizard (app/installer.mts backs all of these): GET /api/setup {firstRun, settings,
//         adapters, candidates, installed, available, dataDir, dataDirCheck} · GET /api/setup/scanner?adapter=<id> {version, script}
//         (a paste-transport adapter's bundled scanner, for the page's Copy button) · POST /api/setup/locate {adapter, dir}
//         · POST /api/setup/install {adapter, scriptsDir} (409 while a Legion script is running in the
//         client, per installer.mts's bridge-status guard) · POST /api/import/paste {text, adapter} (413 past watcher.mts's MAX_INBOX_BYTES; app/import.mts's parsePastedScan:
//         what the ClassicUO web-client scanner prints, marker block or bare JSON, upgraded/validated
//         and written straight into that adapter's inbox — for a client whose sandbox can't write
//         files at all) · POST /api/import/rescan {} (scanOnce() on every running watcher, for a scan
//         file the folder watcher missed; {adapters: [ids swept]}, empty under --demo; 503 with
//         {failed: [ids]} when an inbox could not be swept) ·
//         GET /api/update-check (a GitHub releases/latest check, 10 s timeout, a success cached for an
//         hour; {configured: false} when package.json names no GitHub repo) ·
//         POST /api/host/pick-folder {title} and POST /api/host/open-path {which: "data"|"logs"} — both
//         need the optional `host` startServer({..}, {host}) was given (a folder-picker/opener the
//         Electron shell supplies); 501 on the bare server. GET/PUT /api/settings additionally carries
//         setupDone and client ({adapter, scriptsDir} | null).
// Every text/html response carries the Content-Security-Policy below (including frame-ancestors
// 'none'); every response carries x-content-type-options: nosniff and x-frame-options: DENY. Any
// PUT/POST whose body is read must declare content-type: application/json, else 415 (readBody()) —
// the SSE cancel beacon sends no body, so it's exempt — and its body must be a JSON OBJECT, else 400
// (asObject()). Files and directories this server creates are 0600/0700 (a no-op on Windows).
// The optimizer is scripts/optimizer-core.mts, run straight from source (no build step) — every
// caller imports it from the one path config.mts's paths.core/corePath() resolves (PACKRAT_CORE
// overrides it).
// Localhost security (CONTRIBUTING.md's Security section has the full writeup): every request's
// Host must name this server and its Origin (if any) must match, or 403; with CONFIG.token set,
// every /api/* route but the SSE events stream needs `Authorization: Bearer <token>`, or 401 — the
// bare `node app/vault-server.mts` path runs with no token at all. PUT /api/profiles is capped at 1 MB
// and schema-checked (app/schema/profiles.v2.schema.json). One running optimize job per X-Client-Id
// (a second POST cancels the first and reports {superseded}); job ids are crypto.randomUUID() and the
// events route checks the job's own id against a ?client= query param instead of the token. A route
// that throws returns {error:"internal error", ref} with the stack only in CONFIG.paths.log, keyed by ref.

import http from "node:http";
import { readFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { runKey, reusableRun, runSummary, manualRun, type RunOpts, type SavedRun } from "./runs-lib.mts";
import { isPseudoCharacter, validateScan } from "./scan-schema.mts";
import { loadRules, listRules } from "./rules.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { parseItemQuery, applyItemQuery, facetsOf, wantsHits, hitRow, type ItemQueryRows, type ItemQueryGroups } from "./item-query.mts";
import { optionalSlotsFor } from "./mip.mts";
import { GEAR_SLOTS, buildPools, excludeWeaponsError, resistCapsError, toOptItem } from "./vault-lib.mts";
import { isBuffList, isBuffListsByCharacter, isBuffSkillsByCharacter, isRunBuffs } from "./buffs.mts";
import { startWatcher, MAX_INBOX_BYTES, type StartWatcherOptions, type WatcherHandle } from "./watcher.mts";
import { parsePastedScan, writeScanToInbox } from "./import.mts";
import { createMcp } from "./mcp.mts";
import { readBody, type HttpError } from "./read-body.mts";
import { createScansStore } from "./store/scans.mts";
import { createRunsStore } from "./store/runs.mts";
import { createOrganizeStore } from "./store/organize.mts";
import { createOrganizeStateStore } from "./store/organize-state.mts";
import { createItemKindsStore } from "./store/item-kinds.mts";
import { createBlacklistStore } from "./store/blacklist.mts";
import { createProfilesStore } from "./store/profiles.mts";
import { createUiPrefsStore, isColWidths, isDrawerWidth, isManualSuit, UI_PREF_CHOICES, UI_PREF_LISTS, UI_PREF_VERSIONS } from "./store/ui-prefs.mts";
import { createSettingsStore, type ClientSettings, type SettingsDoc } from "./store/settings.mts";
import { createSettingsService } from "./services/settings.mts";
import { createEventBus, sse } from "./services/events.mts";
import { createSetupService } from "./services/setup.mts";
import { createHousesService } from "./services/houses.mts";
import { createRetentionService } from "./services/retention.mts";
import { createInventoryService } from "./services/inventory.mts";
import { createOrganizeService } from "./services/organize.mts";
import { createJobsService, type Job, type JobTimings } from "./services/jobs.mts";
export type { JobTimings } from "./services/jobs.mts";
import { send, asObject, SSE_HEADERS } from "./http/respond.mts";
import { isBoundedInt, isBoundedString, MAX_SERIAL, short } from "./guards.mts";
import { writeFileAtomic } from "./atomic-write.mts";
import { addPanelAutostart, panelPrefsError, readPanelPrefs, tazuoRunning, writePanelPrefs } from "./tazuo-panel.mts";
import { writeBridgeStop } from "./bridge-trip.mts";
import { checkOrganizeConfig, LIMITS, matchProblem, MAX_SETUP_BYTES, type RuleMatch } from "./organize-config.mts";
import { matchCount } from "./organize.mts";
import { PUT_AWAY_REQUEST } from "./put-away.mts";
import { PRESETS } from "./organize-presets.mts";
import { isKindName, kindCount, kindsDocument, kindsFor, salvageKindOverrides, withKinds, withoutKinds, KIND_LIMITS, MAX_KINDS_BYTES, OVERRIDE_KINDS } from "./item-kinds.mts";
import { proposeOrganize, STRATEGY_IDS, type StrategyId } from "./organize-strategies.mts";
import type { HouseSource } from "./house-capture.mts";
import { checkHouseEntry, isHouseId, readHouseMap, saveHouseEntry, MAX_ENTRY_BYTES, type HouseMapDoc } from "./house-names.mts";
import { plotBounds, plotSize } from "./house-model.mts";
import type { HouseApiResponse, HousesApiResponse } from "./house-model-types.mts";
import type { OrganizePlanApiResponse, ProposeResult } from "./organize-types.mts";
import type { RunBody, RunsListBody, RunSummary } from "./runs-types.mts";
import { renderRegion, type Region } from "./facet-map.mts";
import { encodePng } from "./png.mts";
import { addGrab } from "./organize-state.mts";
import { retentionError, retentionOf } from "./retention.mts";
import {
  candidateClientRoots, validateScriptsDir, badPathShape, installedVersion, installScripts, pasteScanner,
  repoFromPackage, checkForUpdates, type CheckForUpdatesResult, type FetchLike, type AdapterInfo,
} from "./installer.mts";
import { dataDirNotice } from "./data-dir-notice.mts";
import { homedir } from "node:os";

import { resolveConfig, ensureLayout, APP_DIR, DATA_DIR_MODE, DATA_FILE_MODE, type Config } from "./config.mts";
import type { Item, Inventory, OptItem } from "./vault-lib.mts";
const HERE = APP_DIR;
// package.json content, handed to us already-parsed — the only fields this file reads off it
// (version, repository) are trusted the same way installer.mts's repoFromPackage trusts its own
// `pkg: unknown` parameter; this cast is the boundary.
const PACKAGE_JSON = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as { version: string; repository?: unknown };
// The page is served from app/dist/, never from the source tree: app/ui/*.mts and the shared
// modules are TypeScript, which no browser can parse. `npm run build:ui` (tsc -p
// tsconfig.browser.json) emits a .mjs for each of them here, rewriting every ./x.mts specifier to
// ./x.mjs on the way out, so the URLs the page fetches are exactly the ones it fetched before.
const WEB = join(HERE, "dist");

const UI_NAME_RE = /^[a-z0-9-]+\.(mjs|css)$/;
const FONT_NAME_RE = /^[a-z0-9-]+\.woff2$/;
// Manual's suit against the inventory (a fill's `pinned`, a manual run's `suit`): each serial a gear piece of its slot in
// the scans, and no two-handed weapon beside a one-hander.
function manualSuitError(inv: Inventory, suit: Record<string, number>, path: string): string | null {
  for (const [slot, serial] of Object.entries(suit)) {
    const it = inv.items[serial];
    if (!it?.gear || it.slot !== slot) return `${path}.${slot}: 0x${serial.toString(16)} is not a gear piece for that slot in your scans`;
  }
  if (suit.twoHanded != null && suit.oneHanded != null && inv.items[suit.twoHanded]!.twoHanded) return `${path}: a two-handed weapon leaves the one-hand slot empty`;
  return null;
}
// Localhost security (spec §4.5): a request's Host must name this server, an Origin (when present)
// must be this same origin, and — with a token configured — every /api/* route except the SSE
// events stream (EventSource cannot carry an Authorization header; see below) must present it. None
// of this applies to the bare `node app/vault-server.mts` path, which runs with CONFIG.token null.
const PROFILES_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v2.schema.json"), "utf8")) as ValidatorSchema;
const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "bridge.v1.schema.json"), "utf8")) as { command: ValidatorSchema; result: ValidatorSchema; status: ValidatorSchema };
const EVENTS_ROUTE_RE = /^\/api\/optimize\/[\w-]+\/events$/;



const MAX_PATH_LEN = 4096;
// A `_vault` tombstone scan, which the fold reads as "forget": the roots it lists (POST /api/forget) or, with
// forgetCharacter, that character (POST /api/forget-character). The key order is the bytes written.
function tombstone(scannedAt: string, shard: string, roots: Array<{ serial: number; kind: string; name: string; opened: boolean }>, forgetCharacter?: string) {
  return {
    schemaVersion: 2, character: "_vault", scannedAt, ...(forgetCharacter === undefined ? {} : { forgetCharacter }),
    adapter: { id: "app", version: "1", client: "Pack Rat", clientVersion: null,
      capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
    shard, stats: {}, equipped: [], roots, containers: {}, items: [],
  };
}
// What a failed locate/install tells the caller. Deliberately says nothing about the path it probed:
// echoing the resolved path back made these routes a clean existence oracle for any absolute path on
// the machine — "existing directory" vs "file or absent", for free, from an unauthenticated route in
// the bare `npm start` configuration (post-review fix, Important 3).
const NO_CLIENT_FOLDER = "no scripts folder found there for that client";
const NO_TILEDATA = "no tiledata.mul found in that folder";

// Every log append in this file goes through here rather than a bare appendFileSync (post-review
// fix, Important 1): a deleted logs/ dir (the Settings tab's own "Open" button shows the user right
// where to find it) or a full disk must never throw out of a log call — ingestFile's and enqueue's
// "never throws" contracts (app/watcher.mts) depend on it, and an uncaught throw from inside a
// route's own catch block (the 500-handler's log line) would otherwise escape as an unhandled
// rejection and take the whole process down. Best-effort: on failure, fall back to console.error
// once for that line and move on; mkdirSync(recursive) re-creates the logs dir lazily if it vanished
// under a running server, since recreating an already-existing dir is a no-op.
function safeAppendLog(file: string, line: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: DATA_DIR_MODE });
    appendFileSync(file, line, { mode: DATA_FILE_MODE });
  } catch (e) {
    console.error(`log write failed (${file}): ${e && (e as Error).message}`);
  }
}

// ---- POST /api/optimize's request shape ---------------------------------------------------------
// Everything below this comment runs on a body any local caller can send. Until this pass the route
// checked `profile` for truthiness and nothing else, so a malformed pools entry reached the worker
// thread and ended the job in an internal-error ref with a full stack in the log — an attacker-driven
// path into the unrotated log file, and a confusing failure for a page bug (post-review fix,
// Important 5). Every helper here returns the reason it refused (for a 400) or null.

// One optimizer candidate: vault-lib's OptItem, {serial, name, slot, props}. The core reads `.props`
// off every entry with no null guard of its own, so both a literal null and an item with no props
// have to be refused here.
function optItemError(it: unknown): string | null {
  if (!it || typeof it !== "object" || Array.isArray(it)) return "every candidate must be an object";
  const props = (it as Record<string, unknown>).props;
  if (!props || typeof props !== "object" || Array.isArray(props)) return "every candidate needs a props object";
  return null;
}
function poolsError(pools: unknown): string | null {
  if (!pools || typeof pools !== "object" || Array.isArray(pools)) return "pools must be an object";
  for (const [slot, list] of Object.entries(pools as Record<string, unknown>)) {
    if (!Array.isArray(list)) return `pools.${short(slot)} must be an array`;
    for (const it of list) { const e = optItemError(it); if (e) return `pools.${short(slot)}: ${e}`; }
  }
  return null;
}
// current is the worn suit: slot -> candidate, or null/absent for an empty slot.
function currentError(current: unknown): string | null {
  if (!current || typeof current !== "object" || Array.isArray(current)) return "current must be an object";
  for (const [slot, it] of Object.entries(current as Record<string, unknown>)) {
    if (it == null) continue;
    const e = optItemError(it); if (e) return `current.${short(slot)}: ${e}`;
  }
  return null;
}
// The search options a caller may set, and the range each one may sit in. An allowlist rather than a
// shape check, so an unknown key is refused rather than handed to the solver — which also means an
// own `__proto__` key out of JSON.parse never reaches the Object.assign that builds fullOpts.
// optionalSlots/warmStart are set by the route itself after this runs; seed/restarts/timeBudgetMs/
// exact/alternatives are what app/ui/builder.mts actually sends.
const OPTS_MAX_TIME_BUDGET_MS = 60 * 60 * 1000;
// The same ranges as numbers the page can show: the Suit Builder's Advanced fields validate against a copy
// (app/ui/builder-model.mts's SOLVER_LIMITS; app/server.test.mts checks the two agree).
export const OPTS_LIMITS = { restarts: { min: 1, max: 10000 }, timeBudgetMs: { min: 0, max: OPTS_MAX_TIME_BUDGET_MS }, alternativesCount: { min: 0, max: 100 } } as const;
// A saved run's settings snapshot (ui/runs.mts settingsSnapshot), as POST /api/runs takes it: only its known fields,
// each of its type and in a sane range, property maps with plain keys (no __proto__), and the resist caps, weapon
// exclusions and buffs held to their own rules.
const RUN_SETTING_FLAGS = ["allowGargoyle", "medOnly", "allowOthersWorn", "ubwsAnyWeapon", "exact"];
// Each search knob's range, as the Suit Builder's Advanced fields hold them (builder-model.mts KNOB_RANGES, from
// OPTS_LIMITS): [min, max, whole number].
const RUN_SETTING_NUMBERS: Record<string, [number, number, boolean]> = {
  strLimit: [1, 1000, true], restarts: [OPTS_LIMITS.restarts.min, OPTS_LIMITS.restarts.max, true], budgetMs: [0, OPTS_MAX_TIME_BUDGET_MS, true],
  altCount: [OPTS_LIMITS.alternativesCount.min, OPTS_LIMITS.alternativesCount.max, true], altTol: [0, 1e9, false],
};
const RUN_SETTING_LISTS = ["softFloors", "lockedSlots", "excludeTags", "excludeRoots", "excludeSkills"];
const plainKey = (k: string): boolean => isBoundedString(k, 64) && !["__proto__", "constructor", "prototype"].includes(k);
function runSettingsError(st: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(st)) {
    if (v == null) continue;
    if (k === "floors" || k === "weights") {
      if (typeof v !== "object" || Array.isArray(v)) return `settings.${k} must be an object`;
      const bad = Object.entries(v).find(([p, n]) => !plainKey(p) || typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e6);
      if (bad) return `settings.${k}.${short(bad[0])} must be a number between -1000000 and 1000000`;
    } else if (RUN_SETTING_FLAGS.includes(k)) { if (typeof v !== "boolean") return `settings.${k} must be a boolean`; }
    else if (Object.hasOwn(RUN_SETTING_NUMBERS, k)) {
      const [min, max, whole] = RUN_SETTING_NUMBERS[k]!;
      if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) return `settings.${k} must be a ${whole ? "whole " : ""}number from ${min} to ${max}`;
    }
    else if (RUN_SETTING_LISTS.includes(k)) {
      if (!Array.isArray(v) || v.length > 200 || v.some((x) => !(isBoundedString(x, 64) || (k === "excludeRoots" && isBoundedInt(x, 0, MAX_SERIAL))))) return `settings.${k} must be a list of names`;
    } else if (k === "race") { if (!["human", "elf", "gargoyle"].includes(v as string)) return "settings.race must be human, elf or gargoyle"; }
    else if (k === "excludeWeapons") { const e = excludeWeaponsError(v, "settings.excludeWeapons"); if (e) return e; }
    else if (k === "resistCaps") { const e = resistCapsError(v, "settings.resistCaps"); if (e) return e; }
    else if (k === "buffs") { if (!isRunBuffs(v)) return "settings.buffs must list known buffs, each once and one form at most, with their numbers in range"; }
    else return `settings.${short(k)} is not a run setting`;
  }
  return null;
}
function optsError(opts: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(opts)) {
    switch (k) {
      case "exact": if (typeof v !== "boolean") return "opts.exact must be a boolean"; break;
      case "seed": if (!isBoundedInt(v, 0, 2 ** 31)) return "opts.seed must be an integer"; break;
      case "restarts": if (!isBoundedInt(v, OPTS_LIMITS.restarts.min, OPTS_LIMITS.restarts.max)) return `opts.restarts must be an integer between ${OPTS_LIMITS.restarts.min} and ${OPTS_LIMITS.restarts.max}`; break;
      case "timeBudgetMs": if (!isBoundedInt(v, 0, OPTS_MAX_TIME_BUDGET_MS)) return `opts.timeBudgetMs must be an integer between 0 and ${OPTS_MAX_TIME_BUDGET_MS}`; break;
      case "optionalSlots":
        if (!Array.isArray(v) || v.length > 32 || v.some((s) => !isBoundedString(s, 32))) return "opts.optionalSlots must be an array of at most 32 slot names";
        break;
      case "alternatives": {
        if (!v || typeof v !== "object" || Array.isArray(v)) return "opts.alternatives must be an object";
        const { count, tolerance } = v as Record<string, unknown>;
        if (!isBoundedInt(count, OPTS_LIMITS.alternativesCount.min, OPTS_LIMITS.alternativesCount.max)) return `opts.alternatives.count must be an integer between ${OPTS_LIMITS.alternativesCount.min} and ${OPTS_LIMITS.alternativesCount.max}`;
        if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) return "opts.alternatives.tolerance must be a non-negative number";
        break;
      }
      default: return `opts.${short(k)} is not a supported search option`;
    }
  }
  return null;
}
// meta is the caller's own bookkeeping, and saveRun() used to persist it verbatim into
// <data>/runs/<uuid>.json — a megabyte of padding in meta.settings became a megabyte on disk that
// every later runStore.all() re-parsed, on the two hottest routes. Copy only the fields saveRun actually
// reads; the route caps the result's serialized size on top of that.
const META_MAX_BYTES = 32e3;
function pickMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (isBoundedString(meta.character, 64)) out.character = meta.character;
  if (isBoundedString(meta.inventoryStamp, 256)) out.inventoryStamp = meta.inventoryStamp;
  if (typeof meta.poolSize === "number" && Number.isFinite(meta.poolSize)) out.poolSize = meta.poolSize;
  if (meta.settings && typeof meta.settings === "object" && !Array.isArray(meta.settings)) out.settings = meta.settings;
  if (meta.skipped && typeof meta.skipped === "object" && !Array.isArray(meta.skipped)) out.skipped = meta.skipped;
  return out;
}

// What only a real desktop shell (Electron) can supply to startServer — see the `host` parameter
// note below. `title` stays `unknown` rather than `string` because it begins life as a request-body
// field: the route drops anything that is not a short string before calling, and electron/host-args
// .mts coerces it again at the far end, but the TYPE records where the value came from.
// openPath takes the DISCRIMINATOR "data" | "logs", never a resolved path: the shell owns those two
// directories and looks them up itself, so this process — the lower-trust half of the split — cannot
// name a third thing for the OS to launch (phase-7 security review, area-4 Important 1).
export interface HostBridge {
  pickFolder?: ((opts: { title?: unknown }) => Promise<string | null>) | undefined;
  openPath?: ((which: "data" | "logs") => Promise<void>) | undefined;
}


// Where the server looks for the player's game client: `home` (the scripts' ~ and ~/.pack-rat default)
// and the auto-detected scripts folders per adapter (GET /api/setup's `candidates`, and the data-folder
// check's fallback when no client is configured). The default is this machine's real home and
// installer.mts's candidateClientRoots — which, on win32, also probes a fixed C:\TazUO — so a test
// passes its own to never reach a real client folder on any OS.
//
// PACKRAT_CLIENT_HOME swaps the real home for another folder, for a server started in another process
// (the Electron UI tests launch the whole app, so they cannot hand startServer an option): the search
// then looks only under that folder, with no environment folders (LOCALAPPDATA) and no fixed roots
// (C:\TazUO), so a test launch can never find, or read the packrat-paths.json of, a real client.
export interface ClientSearch {
  home: string;
  candidates: (adapter: AdapterInfo) => string[];
}
export function defaultClientSearch(env: NodeJS.ProcessEnv = process.env): ClientSearch {
  if (env.PACKRAT_CLIENT_HOME) {
    const home = resolve(env.PACKRAT_CLIENT_HOME);
    // "linux" is the platform with no fixed roots; an adapter for another OS still offers nothing.
    return { home, candidates: (a) => (a.platform && a.platform !== process.platform ? [] : candidateClientRoots({ adapter: a.id, home, platform: "linux", env: {} })) };
  }
  const home = homedir();
  return { home, candidates: (a) => candidateClientRoots({ adapter: a.id, home, platform: process.platform, env, adapterPlatform: a.platform }) };
}

export interface StartServerOptions {
  host?: HostBridge | undefined;
  clientSearch?: ClientSearch | undefined;
  watcherOptions?: Partial<StartWatcherOptions> | undefined;
  jobTimings?: JobTimings | undefined;
  // Whether a TazUO client is running (app/tazuo-panel.mts's tazuoRunning); a test supplies its own.
  clientRunning?: (() => boolean) | undefined;
  // The fetch GET /api/update-check asks GitHub with; a test supplies its own so the suite never calls GitHub.
  updateFetch?: FetchLike | undefined;
}

export interface ServerHandle {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

// startServer binds one HTTP server to config.port (0 = OS-assigned) and returns a handle for
// tests and launchers alike: { server, port, url, close() }. Nothing runs at import time — every
// config-derived path, the optimizer core, and the route handler live inside this function so a
// test can spin up (and tear down) as many independent instances as it likes.
// `host` is what only a real desktop shell (Electron) can supply: { pickFolder({title}) ->
// Promise<string|null>, openPath(which: "data" | "logs") -> Promise<void> }. Without it, POST /api/host/* answers 501
// ("not available outside the desktop app") rather than throwing — the bare `node app/vault-server.mts`
// / test-harness path never has a folder picker or an OS file-opener to call.
// `watcherOptions` is passed straight through to every app/watcher.mts startWatcher() call below —
// nothing outside tests should ever set it, since the defaults (debounceMs/retries/retryDelayMs) are
// real product behavior. It exists so a test that wants to observe a reject-after-retries cycle over
// SSE doesn't have to wait out the real debounce + backoff (300ms + 2×700ms = 1700ms of production
// timing) inside a fixed-timeout SSE read — app/watcher.test.mts already shortens these same knobs
// (debounceMs:20, retryDelayMs:20) when calling startWatcher() directly; this gives app/server.test.mts
// the same lever for the route-level equivalent instead of relying on a wide timeout margin to absorb
// real wall-clock retry delay plus whatever scheduling/fs-watch jitter a loaded machine adds on top.
// `jobTimings` (JobTimings above) shortens the job clocks for a test in the same way.
export async function startServer(config: Config = ensureLayout(resolveConfig()), { host, clientSearch = defaultClientSearch(), watcherOptions = {}, jobTimings = {}, clientRunning = () => tazuoRunning(), updateFetch = fetch }: StartServerOptions = {}): Promise<ServerHandle> {
  const CONFIG = config;
  const SCANS = CONFIG.paths.scans, PROFILES = CONFIG.paths.profiles, DEFAULT_PROFILES = CONFIG.paths.defaultProfiles;
  const RUNS = CONFIG.paths.runs, SETTINGS = CONFIG.paths.settings, USER_RULES_DIR = CONFIG.paths.rules;
  // Sibling of app/ at the repo root by default — each adapters/<id>/ directory that ships a
  // capabilities.json is one adapter the non-demo server watches an inbox for (today: three —
  // adapters/tazuo/, adapters/razor-enhanced/, and adapters/classicuo-web/, the last of which never
  // has anything to watch since its "paste" transport writes into the inbox only via POST
  // /api/import/paste, never a folder drop). Overridable (config.mts's --adapters/PACKRAT_ADAPTERS_DIR)
  // so a test can point a real running server at a throwaway folder of fixture adapters instead of the
  // repo's real ones.
  const ADAPTERS_DIR = CONFIG.paths.adaptersDir || join(HERE, "..", "adapters");

  // No build step — CONFIG.paths.core resolves straight to scripts/optimizer-core.mts (or wherever
  // PACKRAT_CORE points); each optimize-worker.mts thread imports it by URL for its own copy. The main
  // thread never imports it itself — every optimizeSuit/scoreSet call (heuristic or, since HiGHS,
  // exact) happens inside that one worker (app/exact-solver.mts).
  if (!existsSync(CONFIG.paths.core)) throw new Error(`optimizer core not found at ${CONFIG.paths.core} — check PACKRAT_CORE, or that the repo checkout has scripts/optimizer-core.mts`);
  const CORE_URL = pathToFileURL(CONFIG.paths.core).href;

  function startupWarning(msg: string): void {
    console.warn(msg);
    safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} startup-fallback ${msg}\n`);
  }
  const setupService = createSetupService({ adaptersDir: ADAPTERS_DIR, dataDir: CONFIG.dataDir, demo: CONFIG.demo, clientSearch });
  const appSettings = createSettingsService({ store: createSettingsStore({ file: SETTINGS, warn: startupWarning }), rulesDir: USER_RULES_DIR,
    isKnownAdapter: setupService.isKnown, warn: startupWarning });

  const dataDirWarning = dataDirNotice(setupService.dataDirCheck(appSettings.current().client));
  if (dataDirWarning) console.warn(dataDirWarning);

  // ---- /api/events: one shared SSE stream, fed by one app/watcher.mts per adapter ------------------
  // Non-demo only — --demo's paths.scans is the committed app/fixtures/, which a watcher must never
  // write into. Each adapter is a directory under adapters/ that ships a capabilities.json; today
  // that's just adapters/tazuo/. watchers: id -> {close(), scanOnce()}; eventBus: every response
  // currently attached to GET /api/events, so a later accept/reject can broadcast to all of them.
  const watchers = new Map<string, WatcherHandle>();
  const eventBus = createEventBus();
  // The watchers themselves start only once the port is bound (startWatchers(), called after
  // listen() below): their startup sweep moves inbox files into scans/, and a server that then fails
  // to bind (EADDRINUSE) must not have done that, nor leave live watchers behind it.
  function startWatchers(): void {
    if (CONFIG.demo) return;
    let adapterIds: string[] = [];
    try {
      adapterIds = readdirSync(ADAPTERS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(ADAPTERS_DIR, d.name, "capabilities.json")))
        .map((d) => d.name)
        .sort();
    } catch { /* no adapters/ directory at all — nothing to watch */ }
    for (const id of adapterIds) {
      const handle = startWatcher({
        // getShard reads appSettings.current().shard live, per ingest — not captured once here — so a
        // PUT /api/settings shard switch takes effect on the very next dropped file (app/watcher.mts).
        inboxDir: CONFIG.paths.inboxFor(id), adapter: id, scansDir: SCANS, getShard: () => appSettings.current().shard,
        log: (msg) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} watcher[${id}] ${msg}\n`),
        onAccepted: ({ file, character, scannedAt }) => eventBus.broadcast("inventory", { file, character, scannedAt, at: Date.now() }),
        onRejected: ({ file, reason }) => eventBus.broadcast("rejected", { file, reason, at: Date.now() }),
        request: { name: PUT_AWAY_REQUEST, handle: (path) => organizeService.putAway(id, path) },
        ...watcherOptions,
      });
      watchers.set(id, handle);
    }
  }

  const scanStore = createScansStore({ dir: SCANS, shard: () => appSettings.current().shard });

  // GET /api/update-check's last successful answer (see that route).
  const UPDATE_CHECK_TTL_MS = 60 * 60 * 1000;
  let updateCheckCache: { at: number; result: CheckForUpdatesResult } | null = null;

  const houseService = createHousesService({ settings: appSettings.current });

  const uiPrefsStore = createUiPrefsStore(join(CONFIG.dataDir, "ui-prefs.json"));
  // The TazUO panel's hotkey and show-at-login choice (app/tazuo-panel.mts); the in-game panel writes it too.
  const PANEL_PREFS = join(CONFIG.dataDir, "tazuo-panel.json");
  const savePanel = (change: object): void => writePanelPrefs(PANEL_PREFS, { ...readPanelPrefs(PANEL_PREFS), ...change }, DATA_FILE_MODE);
  const blacklistStore = createBlacklistStore(join(CONFIG.dataDir, "scan-blacklist.json"));
  const itemKindsStore = createItemKindsStore(join(CONFIG.dataDir, "item-kinds.json"));
  const organizeStore = createOrganizeStore(join(CONFIG.dataDir, "organize.json"));
  // <data>/house-map.json: the player's house names (issue #164, app/house-names.mts). A file that does not parse is
  // moved aside and the houses read unnamed; what a read set aside or left out goes to the log, once while it stays the same.
  const HOUSE_MAP = join(CONFIG.dataDir, "house-map.json");
  let namesProblem: string | null = null;
  function readNames(): HouseMapDoc {
    const { doc, problem } = readHouseMap(HOUSE_MAP);
    if (problem && problem !== namesProblem) safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} ${problem}\n`);
    namesProblem = problem;
    return doc;
  }
  const organizeStateStore = createOrganizeStateStore(join(CONFIG.dataDir, "organize-state.json"));
  const inventoryService = createInventoryService({ scanStore, itemKindsStore, organizeStateStore, shard: () => appSettings.current().shard, harvest: (now) => organizeService.harvestNow(now) });
  const getInventory = inventoryService.getInventory;
  const profilesStore = createProfilesStore({ file: PROFILES, defaults: DEFAULT_PROFILES, log: (line) => safeAppendLog(CONFIG.paths.log, line) });

  // ---- optimizer jobs: one worker thread per build, progress over Server-Sent Events -----------
  const timers = new Set<NodeJS.Timeout>();   // every setTimeout/setInterval this instance owns, so close() can stop them all

  // A folder dialog whose answer never comes back would otherwise hang this request for ever:
  // server.requestTimeout governs request RECEIPT only and never touches a response that has not
  // started. Bound it here and answer 504 instead of holding the socket open. The embedder bounds its
  // own half of the same call with the same 60 s (electron/pending-calls.mts, whose expiry rejects
  // with this very statusCode), so whichever side notices first the caller sees one answer — this is
  // not a second chance for a call the shell already gave up on (area-4 minor 5).
  const HOST_CALL_TIMEOUT_MS = 60 * 1000;
  function withHostTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        const e = new Error("the desktop app did not answer") as HttpError;
        e.statusCode = 504;
        reject(e);
      }, HOST_CALL_TIMEOUT_MS);
      t.unref(); timers.add(t);
      const done = (): void => { clearTimeout(t); timers.delete(t); };
      p.then((v) => { done(); resolve(v); }, (e: unknown) => { done(); reject(e as Error); });
    });
  }

  function streamJob(job: Job, res: http.ServerResponse): void {
    res.writeHead(200, SSE_HEADERS);
    sse(res, "hello", jobService.snapshot(job));   // catch-up: last progress, or the final outcome if it already ended
    if (job.state !== "running") { res.end(); return; }
    job.clients.add(res);
    const ping = setInterval(() => sse(res, "ping", { at: Date.now() }), 5000);
    ping.unref(); timers.add(ping);
    res.on("close", () => { clearInterval(ping); timers.delete(ping); job.clients.delete(res); });
  }

  // ---- saved runs: one JSON file per finished build in app/data/runs/ -------------------------------
  const runStore = createRunsStore(RUNS);
  const jobService = createJobsService({ coreUrl: CORE_URL, timings: jobTimings, runStore, log: (line) => safeAppendLog(CONFIG.paths.log, line) });
  const organizeService = createOrganizeService({ paths: CONFIG.paths, getInventory, organizeStore, organizeStateStore, blacklistStore, runStore,
    rules: appSettings.rules, runsTrips: setupService.runsTrips, events: eventBus, log: (line) => safeAppendLog(CONFIG.paths.log, line) });

  // ---- retention (issue #28): old scans and saved runs, per settings.json's `retention` ----------------
  const retentionService = createRetentionService({ demo: CONFIG.demo, retention: () => appSettings.saved().retention, scanStore, runStore, events: eventBus,
    log: (line) => safeAppendLog(CONFIG.paths.log, line) });

  // The built-in MCP server (app/mcp.mts, issue #211): its own listener and token, opened once this server listens
  // (when mcp.json says on) and on PUT /api/mcp; its tools call this server's routes over loopback.
  const mcp = createMcp({ file: CONFIG.paths.mcp, version: PACKAGE_JSON.version, appPort: () => (server.address() as AddressInfo).port, appToken: CONFIG.token,
    log: (line) => safeAppendLog(CONFIG.paths.log, line.endsWith("\n") ? line : `${new Date().toISOString()} ${line}\n`) });
  const mcpState = () => { const { config: { version: _version, ...config }, live } = mcp.state(); return { ok: true, config, live }; };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${CONFIG.port}`);   // req.url is always set for a real request this server routes (Node only leaves it undefined for CONNECT, which no route here handles)
    try {
      // ---- middleware order (spec §4.5): (1) Host (2) Origin (3) token, all before any route ----
      // server.listen(...) below always binds a TCP port on 127.0.0.1 (never a Unix socket), and no
      // request reaches this handler before the 'listening' event fires — address() is always an
      // AddressInfo at this point; the cast documents that invariant.
      const boundPort = (server.address() as AddressInfo).port;
      const hostOk = req.headers.host === `127.0.0.1:${boundPort}` || req.headers.host === `localhost:${boundPort}`;
      if (!hostOk) return send(res, 403, { ok: false, error: "forbidden host" });
      const origin = req.headers.origin;
      if (origin != null && origin !== `http://127.0.0.1:${boundPort}` && origin !== `http://localhost:${boundPort}`) {
        return send(res, 403, { ok: false, error: "forbidden origin" });
      }
      const isEventsRoute = EVENTS_ROUTE_RE.test(url.pathname);
      if (CONFIG.token && url.pathname.startsWith("/api/") && !isEventsRoute) {
        const want = Buffer.from(`Bearer ${CONFIG.token}`);
        const got = Buffer.from(String(req.headers.authorization || ""));
        const authOk = got.length === want.length && timingSafeEqual(got, want);
        if (!authOk) return send(res, 401, { ok: false, error: "unauthorized" });
      }
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, readFileSync(join(HERE, "index.html"), "utf8"), "text/html");
      if (req.method === "GET" && url.pathname === "/favicon.png") return send(res, 200, readFileSync(join(HERE, "assets", "favicon.png")), "image/png");
      if (req.method === "GET" && url.pathname === "/logo-mark.png") return send(res, 200, readFileSync(join(HERE, "assets", "logo-mark.png")), "image/png");
      if (req.method === "GET" && url.pathname === "/vault-lib.mjs") return send(res, 200, readFileSync(join(WEB, "vault-lib.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname === "/item-query.mjs") return send(res, 200, readFileSync(join(WEB, "item-query.mjs"), "utf8"), "text/javascript");
      // The rule editor opens an Auto rule as the planner reads it (organize-config.mts's ruleMatchOf, issue #150).
      if (req.method === "GET" && url.pathname === "/organize-config.mjs") return send(res, 200, readFileSync(join(WEB, "organize-config.mjs"), "utf8"), "text/javascript");
      // Manual's buffs read the same catalog the server checks ui-prefs with (app/buffs.mts, issue #12).
      if (req.method === "GET" && url.pathname === "/buffs.mjs") return send(res, 200, readFileSync(join(WEB, "buffs.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname === "/data-dir-notice.mjs") return send(res, 200, readFileSync(join(WEB, "data-dir-notice.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname === "/scan-schema.mjs") return send(res, 200, readFileSync(join(WEB, "scan-schema.mjs"), "utf8"), "text/javascript");
      // The Import drawer's instant preview parses a paste with the server's own rule (app/paste-scan.mts).
      if (req.method === "GET" && url.pathname === "/paste-scan.mjs") return send(res, 200, readFileSync(join(WEB, "paste-scan.mjs"), "utf8"), "text/javascript");
      // scan-schema.mjs imports validate() from here — the browser resolves that relative import
      // against scan-schema.mjs's own served URL, so this needs its own static route too.
      if (req.method === "GET" && url.pathname === "/schema/validate.mjs") return send(res, 200, readFileSync(join(WEB, "schema", "validate.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname.startsWith("/ui/fonts/")) {
        // One flat folder of woff2 files and nothing else: the licence texts next to them, a subfolder or
        // a dot-dot never match the name pattern.
        const name = url.pathname.slice("/ui/fonts/".length);
        const f = join(HERE, "ui", "fonts", name);
        if (!FONT_NAME_RE.test(name) || !existsSync(f)) return send(res, 404, { ok: false, error: "not found" });
        return send(res, 200, readFileSync(f), "font/woff2");
      }
      if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
        const name = url.pathname.slice("/ui/".length);
        if (!UI_NAME_RE.test(name)) return send(res, 404, { ok: false, error: "not found" });
        // Modules come from the build (app/dist/ui/), stylesheets from the source tree: tsc emits only
        // what it compiles, so styles.css never appears in app/dist/. Splitting here keeps one URL space
        // (/ui/<name>) over two directories rather than adding a copy step to the build.
        const f = name.endsWith(".css") ? join(HERE, "ui", name) : join(WEB, "ui", name);
        if (!existsSync(f)) return send(res, 404, { ok: false, error: "not found" });
        return send(res, 200, readFileSync(f, "utf8"), name.endsWith(".css") ? "text/css" : "text/javascript");
      }
      if (req.method === "GET" && url.pathname === "/api/inventory") {
        const { inv, missing, snapshotCount } = await getInventory();
        const itemsArr = Object.values(inv.items);
        const worn: Record<string, Item[]> = {}, rootCounts: Record<string, number> = {};
        for (const it of itemsArr) {
          if (it.equippedBy) (worn[it.equippedBy] ||= []).push(it);
          if (it.root != null) rootCounts[it.root] = (rootCounts[it.root] || 0) + 1;
        }
        const facets = facetsOf(itemsArr, { rarity: appSettings.rules().rarity });
        // A blacklisted container is never opened again, so its last two scans are stale: it reports nothing.
        const listed = new Set(blacklistStore.read().map((e) => String(e.serial)));
        const missingCounts = Object.fromEntries(Object.entries(missing).filter(([root]) => !listed.has(root)).map(([root, list]) => [root, list.length]));
        const inventory = { scans: inv.scans, characters: inv.characters, containers: inv.containers, worn, rootCounts, missingCounts, itemCount: itemsArr.length, facets, propKeys: facets.propKeys };
        return send(res, 200, { ok: true, snapshotCount, demo: CONFIG.demo, inventory });
      }
      // GET /api/missing?root=<serial> — the items missing from that root since its last scan (app/missing.mts,
      // issue #99); /api/inventory carries only the counts. A root with nothing missing, or blacklisted, answers an empty list.
      if (req.method === "GET" && url.pathname === "/api/missing") {
        const root = url.searchParams.get("root") || "";
        if (!/^\d{1,10}$/.test(root)) return send(res, 400, { ok: false, error: "root must be a container serial" });
        const { missing } = await getInventory();
        const listed = blacklistStore.read().some((e) => e.serial === +root);
        return send(res, 200, { ok: true, items: (!listed && missing[String(+root)]) || [] });
      }
      if (req.method === "GET" && url.pathname === "/api/items") {
        const { inv } = await getInventory();
        const query = parseItemQuery(url.searchParams);
        const result = applyItemQuery(Object.values(inv.items), query, { rarity: appSettings.rules().rarity });
        if (wantsHits(url.searchParams)) return send(res, 200, { ok: true, total: result.total, offset: query.offset, limit: query.limit, rows: (result as ItemQueryRows).rows.map(hitRow) });
        // applyItemQuery returns the ItemQueryRows | ItemQueryGroups union; narrow at each call site
        // by query.group, same as app/item-query.test.mts does — `total` is common to both branches.
        if (query.group) { const g = result as ItemQueryGroups; return send(res, 200, { ok: true, total: g.total, stacks: g.stacks, pieces: g.pieces, offset: query.offset, limit: query.limit, groups: g.groups }); }
        return send(res, 200, { ok: true, total: result.total, pieces: (result as ItemQueryRows).pieces, offset: query.offset, limit: query.limit, rows: (result as ItemQueryRows).rows });
      }
      // GET /api/items/by-serial?serials=1,2,3 — the one place the page can still ask for a FULL item
      // record (location, tags, equippedBy…) by serial, now that GET /api/inventory never carries the
      // whole item map: the suit builder's result panel and the hover tooltip both need to enrich a bare
      // serial (from a paged /api/items row that scrolled off, or an optimizer pool item, which only ever
      // carries {serial,name,slot,props}) on demand. Capped at 200 serials per call; a serial with no
      // matching item is simply absent from the response rather than an error.
      if (req.method === "GET" && url.pathname === "/api/items/by-serial") {
        const raw = (url.searchParams.get("serials") || "").split(",").map((s) => s.trim()).filter(Boolean);
        if (!raw.length || raw.length > 200 || raw.some((s) => !/^\d+$/.test(s))) {
          return send(res, 400, { ok: false, error: "serials must be 1-200 comma-separated non-negative integers" });
        }
        const { inv } = await getInventory();
        const items: Record<string, Item> = {};
        for (const s of raw) { const it = inv.items[s]; if (it) items[s] = it; }
        return send(res, 200, { ok: true, items });
      }
      if (req.method === "GET" && url.pathname === "/api/profiles") return send(res, 200, { ok: true, profiles: await profilesStore.read() });
      if (req.method === "PUT" && url.pathname === "/api/profiles") {
        const body = await readBody(req, { limit: 1e6, tooLargeMsg: "profiles too large" });
        const { ok, errors } = validate(PROFILES_SCHEMA, body);
        if (!ok) return send(res, 400, { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}`, errors });
        profilesStore.write(body);
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/ui-prefs") return send(res, 200, { ok: true, prefs: uiPrefsStore.read() });
      if (req.method === "PUT" && url.pathname === "/api/ui-prefs") {
        // The page's own view choices (the Inventory tab's columns, the look, the sidebar). Kept here rather than in
        // the page's localStorage because the desktop app serves the page from a new port, and so a new
        // origin, on every launch. Only known fields, each checked, are written.
        const body = asObject(await readBody(req, { limit: 16e3 }));
        const next = uiPrefsStore.read();
        for (const key of UI_PREF_LISTS) {
          if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
          const v = body[key];
          if (!Array.isArray(v) || v.length > 200 || !v.every((c) => isBoundedString(c, 64))) return send(res, 400, { ok: false, error: `${key} must be a list of at most 200 keys` });
          next[key] = v as string[];
        }
        for (const [key, allowed] of Object.entries(UI_PREF_CHOICES)) {
          if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
          const v = body[key];
          if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) return send(res, 400, { ok: false, error: `${key} must be one of ${allowed.join(", ")}` });
          next[key as keyof typeof UI_PREF_CHOICES] = v;
        }
        if (Object.prototype.hasOwnProperty.call(body, "colWidths")) {
          if (!isColWidths(body.colWidths)) return send(res, 400, { ok: false, error: "colWidths must map at most 200 column keys to whole widths from 40 to 1200 px" });
          next.colWidths = body.colWidths;
        }
        if (Object.prototype.hasOwnProperty.call(body, "mapDrawerWidth")) {
          if (!isDrawerWidth(body.mapDrawerWidth)) return send(res, 400, { ok: false, error: "mapDrawerWidth must be a whole width from 320 to 4000 px" });
          next.mapDrawerWidth = body.mapDrawerWidth;
        }
        if (Object.prototype.hasOwnProperty.call(body, "manualSuit")) {
          if (!isManualSuit(body.manualSuit)) return send(res, 400, { ok: false, error: "manualSuit must map the suit's slots to item serials" });
          next.manualSuit = body.manualSuit;
        }
        // Manual's buffs (app/buffs.mts): catalog ids, and the numbers they scale with, each within its bounds.
        if (Object.prototype.hasOwnProperty.call(body, "manualBuffs")) {
          if (!isBuffList(body.manualBuffs)) return send(res, 400, { ok: false, error: "manualBuffs must list known buffs, each once, one form at most" });
          next.manualBuffs = body.manualBuffs;
        }
        // Automatic's, by character.
        if (Object.prototype.hasOwnProperty.call(body, "autoBuffs")) {
          if (!isBuffListsByCharacter(body.autoBuffs)) return send(res, 400, { ok: false, error: "autoBuffs must map characters to known buffs, each once, one form at most" });
          next.autoBuffs = body.autoBuffs;
        }
        if (Object.prototype.hasOwnProperty.call(body, "buffSkills")) {
          if (!isBuffSkillsByCharacter(body.buffSkills)) return send(res, 400, { ok: false, error: "buffSkills must map characters to known buff skills, each a number within its range" });
          next.buffSkills = body.buffSkills;
        }
        for (const key of UI_PREF_VERSIONS) {
          if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
          if (!isBoundedString(body[key], 64)) return send(res, 400, { ok: false, error: `${key} must be a version of at most 64 characters` });
          next[key] = body[key];
        }
        uiPrefsStore.write(next);
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/settings") return send(res, 200, { ok: true, settings: appSettings.current() });
      if (req.method === "PUT" && url.pathname === "/api/settings") {
        // Any subset of {shard, setupDone, client} — Task 2 extended this route to carry the setup
        // wizard's own state without disturbing the shard-switch contract above it. Each field present
        // in the body is validated before ANYTHING is written (load-then-persist, same reasoning as
        // before: a rejected field must never partially land on disk or in memory), and every field is
        // now checked POSITIVELY — a string is a bounded string, a folder is a folder this server is
        // willing to read (post-review fix, area-3 finding 3: client.scriptsDir used to be persisted on
        // a bare typeof check, after which GET /api/setup readdir/readFileSync'd whatever it named on
        // every page load, hanging the whole single-threaded process on a FIFO and dialling out over
        // SMB for a UNC path). These three are the only fields this route persists.
        const body = asObject(await readBody(req));
        let nextRules = appSettings.rules(), nextFallback = appSettings.rulesFallback();
        const hasShard = Object.prototype.hasOwnProperty.call(body, "shard");
        if (hasShard) {
          if (!isBoundedString(body.shard, 64)) return send(res, 400, { ok: false, error: "settings.shard must be a string" });
          try { nextRules = loadRules(body.shard, { userRulesDir: USER_RULES_DIR }); }
          catch { return send(res, 400, { ok: false, error: `unknown or invalid shard: ${body.shard}` }); }
          nextFallback = false;
        }
        if (Object.prototype.hasOwnProperty.call(body, "setupDone") && typeof body.setupDone !== "boolean") {
          return send(res, 400, { ok: false, error: "settings.setupDone must be a boolean" });
        }
        if (Object.prototype.hasOwnProperty.call(body, "autoUpdateCheck") && typeof body.autoUpdateCheck !== "boolean") {
          return send(res, 400, { ok: false, error: "settings.autoUpdateCheck must be a boolean" });
        }
        const hasRetention = Object.prototype.hasOwnProperty.call(body, "retention");
        const retentionBad = hasRetention ? retentionError(body.retention) : null;
        if (retentionBad) return send(res, 400, { ok: false, error: retentionBad });
        // undefined = the body said nothing about the client and the persisted one is left alone;
        // null = clear it (an explicit null, or a folder-transport client with an empty scriptsDir); an
        // object = a validated, RESOLVED {adapter, scriptsDir}. A paste-transport client has no scripts
        // folder, so it is kept with scriptsDir "" — what the wizard's finish() sends for one.
        let nextClient: ClientSettings | null | undefined;
        if (Object.prototype.hasOwnProperty.call(body, "client")) {
          const c = body.client;
          if (c === null) nextClient = null;
          else {
            const rec = (c && typeof c === "object" && !Array.isArray(c)) ? c as Record<string, unknown> : null;
            if (!rec || !isBoundedString(rec.adapter, 64) || typeof rec.scriptsDir !== "string" || rec.scriptsDir.length > MAX_PATH_LEN) {
              return send(res, 400, { ok: false, error: "settings.client must be null or {adapter, scriptsDir}" });
            }
            const adapter = rec.adapter;
            // Security (post-review fix): client.adapter must be a real, known adapter id before it can
            // ever reach installer.mts's path.join calls — see the /api/setup/install note below.
            const info = setupService.adapters().find((a) => a.id === adapter);
            if (!info) {
              return send(res, 400, { ok: false, error: `settings.client.adapter: unknown adapter "${adapter}"` });
            }
            if (info.transport === "paste") nextClient = { adapter, scriptsDir: "" };
            else if (!rec.scriptsDir.trim()) nextClient = null;
            else {
              // The same acceptance POST /api/setup/locate applies, so the wizard and a hand-written
              // settings PUT can never disagree about what a scripts folder is — and the RESOLVED
              // path is what gets persisted, not the raw body value.
              const located = validateScriptsDir(rec.scriptsDir, adapter);
              if (!located.ok) return send(res, 400, { ok: false, error: `settings.client.scriptsDir: ${NO_CLIENT_FOLDER}` });
              nextClient = { adapter, scriptsDir: located.scriptsDir };
            }
          }
        }
        // uoFolder (issue #10): the folder the house map reads tiledata.mul from, or null for automatic (TazUO's launcher). Checked like the client folder: a bounded string of an absolute, non-UNC shape before any filesystem call (installer.mts's badPathShape: a UNC path's first stat is an outbound SMB connection), then a folder holding a tiledata.mul file. The error never echoes the path.
        let nextUoFolder: string | null | undefined;
        if (Object.prototype.hasOwnProperty.call(body, "uoFolder")) {
          const v = body.uoFolder;
          if (v === null) nextUoFolder = null;
          else {
            if (!isBoundedString(v, MAX_PATH_LEN) || badPathShape(v)) return send(res, 400, { ok: false, error: "settings.uoFolder must be null or the full path of a folder" });
            const dir = resolve(v);
            let found = false;
            try { found = statSync(dir).isDirectory() && statSync(join(dir, "tiledata.mul")).isFile(); } catch { found = false; }
            if (!found) return send(res, 400, { ok: false, error: `settings.uoFolder: ${NO_TILEDATA}` });
            nextUoFolder = dir;
          }
        }
        // Only the fields this request carried reach settings.json (saveSettings): a startup fallback
        // for a field it did not name stays in memory, where it belongs.
        const changes: Partial<SettingsDoc> = {};
        if (hasShard) changes.shard = body.shard as string;
        if (Object.prototype.hasOwnProperty.call(body, "setupDone")) changes.setupDone = body.setupDone as boolean;
        if (Object.prototype.hasOwnProperty.call(body, "autoUpdateCheck")) changes.autoUpdateCheck = body.autoUpdateCheck as boolean;
        if (nextClient !== undefined) changes.client = nextClient;
        if (nextUoFolder !== undefined) changes.uoFolder = nextUoFolder;
        if (hasRetention) changes.retention = { ...retentionOf(appSettings.saved().retention), ...(body.retention as object) };
        appSettings.save(changes);
        appSettings.applyRules(nextRules, nextFallback);
        return send(res, 200, { ok: true, settings: appSettings.current() });
      }
      if (req.method === "GET" && url.pathname === "/api/tazuo-panel") {
        return send(res, 200, { ok: true, prefs: readPanelPrefs(PANEL_PREFS) });
      }
      if (req.method === "PUT" && url.pathname === "/api/tazuo-panel") {
        const body = asObject(await readBody(req, { limit: 8e3 }));
        const bad = panelPrefsError(body);
        if (bad) return send(res, 400, { ok: false, error: bad });
        if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
        savePanel(body);
        return send(res, 200, { ok: true, prefs: readPanelPrefs(PANEL_PREFS) });
      }
      if (req.method === "POST" && url.pathname === "/api/retention/cleanup") {
        // Settings › Data's Clean up now: {dryRun: true} counts what the pruning would remove (the
        // confirm dialog's sentence), {dryRun: false} removes it and says what went.
        // `refused`: old scans were kept because the inventory would have changed without them.
        const { dryRun } = asObject(await readBody(req, { limit: 8e3 }));
        if (typeof dryRun !== "boolean") return send(res, 400, { ok: false, error: "dryRun must be a boolean" });
        if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
        if (dryRun) { const plan = await retentionService.plan(); return send(res, 200, { ok: true, scans: plan.scans.length, runs: plan.runs.length, refused: plan.refused }); }
        return send(res, 200, { ok: true, ...await retentionService.prune("clean up now") });
      }
      if (req.method === "GET" && url.pathname === "/api/rules") {
        return send(res, 200, { ok: true, shard: appSettings.current().shard, rules: appSettings.rules(), available: listRules({ userRulesDir: USER_RULES_DIR }), fallback: appSettings.rulesFallback() });
      }
      // ---- Setup wizard (Task 2): adapter discovery, client-folder install, scan import, update check.
      if (req.method === "GET" && url.pathname === "/api/setup") {
        const adapters = setupService.adapters();
        const candidates: Record<string, string[]> = {}, available: Record<string, string | null> = {};
        for (const a of adapters) {
          candidates[a.id] = clientSearch.candidates(a);
          available[a.id] = installedVersion(join(ADAPTERS_DIR, a.id), a.id).version;
        }
        // installedVersion() runs against whatever path settings.json names, on every wizard/Settings
        // render. PUT /api/settings and POST /api/setup/install both validate that path now, and
        // installer.mts opens only regular files there (never following a symlink, never blocking on a
        // FIFO, bounded read) — so a hand-edited settings.json can no longer hang or over-read here.
        const client = appSettings.current().client;
        const installed = client ? installedVersion(client.scriptsDir, client.adapter) : null;
        // The id appSettings.bridgeAdapter() is ACTUALLY routing POST /api/bridge / GET /api/bridge/status to right
        // now — reused, not restated, so this can never drift from the real routing decision. Guarded
        // to null when that id doesn't name a real discovered adapter (a test's throwaway --adapters
        // dir with no "tazuo" in it, say): reporting an id nothing can resolve would just move the
        // "buttons for an adapter that doesn't exist" bug onto the page instead of fixing it.
        const resolvedBridgeAdapter = appSettings.bridgeAdapter();
        const bridgeAdapterField = adapters.some((a) => a.id === resolvedBridgeAdapter) ? resolvedBridgeAdapter : null;
        return send(res, 200, {
          ok: true, firstRun: !appSettings.current().setupDone, settings: appSettings.current(), adapters,
          // platform: this machine's process.platform — on this desktop app, always the same machine
          // the player's game client runs on. Lets the wizard/Import tab (app/ui/adapters.mts's
          // availableAdapters) hide a platform-restricted adapter (Razor Enhanced, Windows-only)
          // instead of offering a choice that can never work (Phase 6 final review, deferred minor).
          candidates, installed, available, dataDir: CONFIG.dataDir, platform: process.platform,
          // app/ui/bridge.mts's currentAdapter() falls back to this when settings.client is unset (a
          // hand-installed or Skip-through-the-wizard player) — see the appSettings.bridgeAdapter() comment above.
          bridgeAdapter: bridgeAdapterField,
          dataDirCheck: setupService.dataDirCheck(appSettings.current().client),
          // Settings › Updates names the running version ("Pack Rat 0.1.0") before any update check.
          version: PACKAGE_JSON.version,
          // Whether POST /api/host/open-path can do anything: only the desktop shell opens a folder. The
          // page offers Open there and Copy path in a plain browser (npm start), instead of an Open that
          // answers 501 and vanishes.
          canOpenFolders: typeof host?.openPath === "function",
        });
      }
      if (req.method === "GET" && url.pathname === "/api/setup/scanner") {
        // Read-only and path-free: the id must name a known paste-transport adapter, and the script is that
        // adapter's own bundled packrat-scanner.ts (installer.mts's pasteScanner).
        const adapter = url.searchParams.get("adapter");
        if (!setupService.adapters().some((a) => a.id === adapter && a.transport === "paste")) return send(res, 400, { ok: false, error: `unknown paste adapter: ${short(adapter)}` });
        const scanner = pasteScanner(ADAPTERS_DIR, adapter as string);
        if (!scanner) return send(res, 404, { ok: false, error: "this build ships no scanner for that client" });
        return send(res, 200, { ok: true, ...scanner });
      }
      if (req.method === "POST" && url.pathname === "/api/setup/locate") {
        const { adapter, dir } = asObject(await readBody(req, { limit: 8e3 }));
        // Security (post-review fix): adapter is only ever used in an error string by validateScriptsDir
        // itself, but every route taking an adapter id is checked against the real, known ids the same
        // way, so a caller can't probe with an arbitrary string here either.
        if (!setupService.adapters().some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
        // Every refusal from here down is the same opaque line: this route's whole purpose is to say
        // yes or no about a folder the user picked, and validateScriptsDir's own messages name the
        // path they probed — which made that yes/no a filesystem oracle for any absolute path on the
        // machine (the body cap above is what bounds the path's length).
        const result = validateScriptsDir(dir, adapter);
        if (!result.ok) return send(res, 400, { ok: false, error: NO_CLIENT_FOLDER });
        return send(res, 200, { ok: true, scriptsDir: result.scriptsDir, installed: installedVersion(result.scriptsDir, adapter) });
      }
      if (req.method === "POST" && url.pathname === "/api/setup/install") {
        const { adapter, scriptsDir, panel } = asObject(await readBody(req, { limit: 8e3 }));
        // The wizard's panel choices ride along (app/tazuo-panel.mts), checked before anything is written.
        const panelBad = panel === undefined ? null : panelPrefsError(panel);
        if (panelBad) return send(res, 400, { ok: false, error: panelBad });
        // Security (post-review fix): adapter must be one of listAdapters()'s real ids before it can
        // reach installScripts, which joins it onto adaptersDir to find the scripts to copy — an
        // unchecked adapter (e.g. "../../../../tmp/evil") would otherwise let this route copy an
        // arbitrary packrat-*.py from anywhere on disk into the user's LegionScripts folder.
        // installScripts also re-validates the id itself (defence in depth), but the route rejects it
        // first so the error is the clear "unknown adapter" rather than installScripts' own message.
        if (!setupService.adapters().some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
        // The destination goes through the SAME acceptance POST /api/setup/locate applies (post-review
        // fix, area-3 finding 4): the two halves of the wizard used to disagree about what a scripts
        // folder is — locate validated, install took the raw body value and only installScripts'
        // statSync().isDirectory() stood between it and the copy loop. What gets written to (and
        // persisted as the configured client) is validateScriptsDir's RESOLVED path, so a caller that
        // names a client root gets the nested scripts folder locate would have returned, not the root.
        const located = validateScriptsDir(scriptsDir, adapter);
        if (!located.ok) return send(res, 400, { ok: false, error: NO_CLIENT_FOLDER, code: "badDir" });
        const destDir = located.scriptsDir;
        // bridgeStatusPath is THIS adapter's own bridge status (the one whose scripts are about to be
        // overwritten on disk), not necessarily the currently-configured client's (appSettings.bridgeAdapter()) —
        // those can differ, e.g. installing razor-enhanced for the first time while tazuo is still the
        // configured client from an earlier setup. Guarding against the wrong adapter's running-script
        // state would both miss a real conflict (razor-enhanced's own bridge actually running) and
        // could refuse an install that's perfectly safe (tazuo's bridge running has no bearing on
        // overwriting razor-enhanced's files) — so this always checks the adapter param itself.
        // `adapter as string` here (and in the client assignment below) is the erased cast placed AFTER
        // the allowlist check just above proved it — same pattern installer.mts's own compiler-only
        // casts use.
        const result = installScripts({ adapter, adaptersDir: ADAPTERS_DIR, scriptsDir: destDir, dataDir: CONFIG.dataDir, bridgeStatusPath: CONFIG.paths.bridgeStatusFor(adapter as string),
          log: (msg) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} setup-install ${msg}\n`) });
        if (!result.ok) {
          return send(res, result.code === "running" ? 409 : 400, { ok: false, error: result.error, code: result.code, installed: result.installed });
        }
        appSettings.save({ client: { adapter: adapter as string, scriptsDir: destDir } });
        // The wizard sends its panel options; either install puts the panel in TazUO's autostart list, which
        // it can only do while TazUO is closed (app/tazuo-panel.mts's addPanelAutostart).
        if (panel !== undefined && !CONFIG.demo) savePanel(panel as object);
        const autostart = adapter === "tazuo" && !CONFIG.demo ? addPanelAutostart(destDir, clientRunning) : null;
        // pathsFile: what happened to packrat-paths.json on the way in (written/unchanged/kept/
        // backed-up) — installScripts no longer silently clobbers a hand-authored one, and the page
        // can say so.
        return send(res, 200, { ok: true, installed: result.installed, version: result.version, scriptsDir: destDir, pathsFile: result.pathsFile, autostart });
      }
      if (req.method === "POST" && url.pathname === "/api/import/paste") {
        // Capped at the watcher's own inbox limit: a bigger paste would be written, answered 200, and
        // then rejected by the watcher, so it is refused here instead.
        const { text, adapter } = asObject(await readBody(req, { limit: MAX_INBOX_BYTES, tooLargeMsg: "paste too large" }));
        // Same allowlist as every other adapter-taking route — adapter reaches
        // CONFIG.paths.inboxFor -> path.join, so it must be a real, known id before that.
        if (!setupService.adapters().some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
        const parsed = parsePastedScan(text);
        if (!parsed.ok) return send(res, 400, { ok: false, error: parsed.error });
        // Post-review minor: `adapter` (which inbox the file gets filed under, from the Import tab's
        // picker) and `parsed.doc.adapter.id` (what the pasted document itself says it came from) can
        // disagree — a player who picks the wrong adapter in the dropdown before pasting, most likely
        // when only one client is configured and the picker is hidden (see ui/import.mts's
        // adapterPicker) so the mismatch has no visible cause. Harmless to the fold itself (nothing
        // downstream trusts which inbox a scan sat in over the document's own adapter block), but
        // worth surfacing rather than filing it silently — logged here, and returned as `warning` so
        // the Import tab can show it too.
        // The declared id is the pasted DOCUMENT's own field, so it is caller-controlled text: bounded
        // and JSON.stringify'd before it reaches a log line (post-review fix, Minor 10). A JSON string
        // escape (\n) survives parsePastedScan's literal-newline strip and parses into a real newline,
        // so raw interpolation let a caller forge as many correctly-timestamped log lines as it liked —
        // in the one file the 500-handler's `ref` scheme is built around.
        const declaredAdapter = parsed.doc?.adapter?.id ? short(parsed.doc.adapter.id) : undefined;
        const mismatch = declaredAdapter && declaredAdapter !== adapter;
        if (mismatch) {
          safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} import-paste warn: pasted into ${JSON.stringify(adapter)}'s inbox but the document declares adapter ${JSON.stringify(declaredAdapter)}\n`);
        }
        const { file, character } = writeScanToInbox({ doc: parsed.doc, adapter: adapter as string, paths: CONFIG.paths });
        // Nudge the watcher: there is no reason to make the player wait on fs.watch's debounce when the
        // file is already on disk.
        watchers.get(adapter as string)?.scanOnce();
        return send(res, 200, { ok: true, written: file, character,
          ...(mismatch ? { warning: `filed under "${adapter}", but this scan says it's from "${declaredAdapter}" — check the Adapter picker above` } : {}) });
      }
      if (req.method === "POST" && url.pathname === "/api/import/rescan") {
        asObject(await readBody(req, { limit: 8e3 }));   // {} — no fields read, but every POST still needs a declared JSON object body (readBody's content-type check, asObject's shape check)
        // scanOnce() recreates a deleted inbox and re-arms its watch; false means it could not sweep
        // at all (the reason is in the log), and that is reported rather than answered with ok: true.
        const adapters: string[] = [], failed: string[] = [];
        for (const [id, handle] of watchers) (handle.scanOnce() ? adapters : failed).push(id);
        if (failed.length) return send(res, 503, { ok: false, error: `could not sweep the inbox for ${failed.join(", ")} — see the log`, adapters, failed });
        return send(res, 200, { ok: true, adapters });
      }
      if (req.method === "GET" && url.pathname === "/api/update-check") {
        // Cached for an hour so every page load doesn't cost a GitHub round trip (and its unauthenticated
        // rate limit); a failed check is not cached, so the next request simply tries again.
        if (!updateCheckCache || Date.now() - updateCheckCache.at > UPDATE_CHECK_TTL_MS) {
          const result = await checkForUpdates({ current: PACKAGE_JSON.version, repo: repoFromPackage(PACKAGE_JSON), fetchImpl: updateFetch });
          if (result.error) return send(res, 200, { ok: true, ...result });
          updateCheckCache = { at: Date.now(), result };
        }
        return send(res, 200, { ok: true, ...updateCheckCache.result });
      }
      if (req.method === "POST" && url.pathname === "/api/host/pick-folder") {
        if (!host || typeof host.pickFolder !== "function") return send(res, 501, { ok: false, error: "not available outside the desktop app" });
        const { title } = asObject(await readBody(req, { limit: 8e3 }));
        // A dialog title is a short display string or nothing at all. Anything else — a non-string, or
        // a megabyte of text the 50 MB default body cap used to wave through — falls back to the
        // shell's own default rather than crossing two process hops into a native, app-modal dialog
        // the user is being asked to trust (post-review fix, area-4 minor 1).
        const path = await withHostTimeout(host.pickFolder(isBoundedString(title, 120) ? { title } : {}));
        return send(res, 200, { ok: true, path });
      }
      if (req.method === "POST" && url.pathname === "/api/host/open-path") {
        if (!host || typeof host.openPath !== "function") return send(res, 501, { ok: false, error: "not available outside the desktop app" });
        const { which } = asObject(await readBody(req, { limit: 8e3 }));
        if (which !== "data" && which !== "logs") return send(res, 400, { ok: false, error: 'which must be "data" or "logs"' });
        // The DISCRIMINATOR crosses the wire, not a resolved path (phase-7 security review, area-4
        // Important 1): the shell owns the two directories it maps "data"/"logs" to, so this process —
        // the lower-trust half of the split — cannot name a third thing for the OS to launch.
        await withHostTimeout(host.openPath(which));
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, SSE_HEADERS);
        sse(res, "hello", { ok: true, watching: Array.from(watchers.keys()) });
        eventBus.add(res);
        const ping = setInterval(() => sse(res, "ping", { at: Date.now() }), 15000);
        ping.unref(); timers.add(ping);
        res.on("close", () => { clearInterval(ping); timers.delete(ping); eventBus.remove(res); });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/optimize") {
        // Start a job: the optimizer runs in a worker thread; progress streams from /api/optimize/<id>/events.
        // A header-less caller must never collide with another header-less caller: `x-client-id` stays
        // null for the supersede check below (which only ever compares two non-empty strings), but the
        // JOB's own clientId is always a real string — a fresh, unguessable randomUUID() when no header
        // was sent — so the events route's ?client= check (which requires a non-empty match) can never
        // be satisfied by omission, and a header-less request can never read or supersede another
        // header-less request's job (fixed post-review: null-clientId collision, findings e/h).
        const headerClientId = req.headers["x-client-id"] || null;
        // pools/current/opts/meta/settings stay Record<string,unknown> (property-accessible, every
        // field still `unknown`) all the way through this route; profile/character stay bare `unknown`
        // — nothing here validates their shape beyond what's checked explicitly below (see report).
        let { pools = {}, current = {}, profile, opts = {}, meta = {}, character = null, settings = {}, pinned } = asObject(await readBody(req)) as {
          pools?: Record<string, unknown>; current?: Record<string, unknown>; profile?: unknown; opts?: Record<string, unknown>;
          meta?: Record<string, unknown>; character?: unknown; settings?: Record<string, unknown>; pinned?: unknown;
        };
        // Everything the caller sent is checked before anything is started (post-review fix, Important
        // 5): opts against a small allowlist of search options with real ranges, meta down to the five
        // fields saveRun() reads and a serialized-size cap, and — for the hand-built form below — the
        // pools/current element shapes the optimizer core assumes but never checks.
        if (!opts || typeof opts !== "object" || Array.isArray(opts)) return send(res, 400, { ok: false, error: "opts must be an object" });
        const badOpts = optsError(opts);
        if (badOpts) return send(res, 400, { ok: false, error: badOpts });
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) return send(res, 400, { ok: false, error: "meta must be an object" });
        meta = pickMeta(meta);
        if (JSON.stringify(meta).length > META_MAX_BYTES) return send(res, 400, { ok: false, error: "meta is too large" });
        // The resist cap overrides a saved run is reopened and compared with (the page reads them back as the caps
        // the run was built with), held to the rule profiles.json's are.
        const badCaps = resistCapsError((meta.settings as Record<string, unknown> | undefined)?.resistCaps, "meta.settings.resistCaps");
        if (badCaps) return send(res, 400, { ok: false, error: badCaps });
        // …and the buffs it was planned with (app/buffs.mts), which it is reopened, labeled and compared with
        const runBuffs = (meta.settings as Record<string, unknown> | undefined)?.buffs;
        if (runBuffs != null && !isRunBuffs(runBuffs)) return send(res, 400, { ok: false, error: "meta.settings.buffs must list known buffs, each once and one form at most, with their numbers in range" });
        let skipped: Record<string, number> = {}, blocked: string[] = [];
        // The by-character form: the caller sends {character, settings} instead of building pools/current
        // itself, and the server runs buildPools() against the cached inventory — the same function and
        // the same defaults the page's own optimizerProfile() uses (ui/builder.mts), so a request built
        // this way and an equivalent hand-built {pools,current} request key identically (runKey below) and
        // reuse each other's saved runs.
        // character names a folded inventory key and lands in a saved run's own `character` field —
        // truthy-checked only, until this pass (see report).
        if (character != null && !isBoundedString(character, 64)) return send(res, 400, { ok: false, error: "character must be a string" });
        // Manual's "Fill the rest automatically" (issue #12): `pinned` is Manual's suit, {slot: serial}. Each piece is
        // kept in its slot (buildPools), the search fills only the empty slots, and with no character the pool is the
        // pieces nobody wears. A fill is never saved as a run, nor answered by one.
        if (pinned != null && !isManualSuit(pinned)) return send(res, 400, { ok: false, error: "pinned must map gear slots to serials" });
        const fill = pinned != null;
        if (character || fill) {
          // A `null` in any optional field (as a saved run's settings can carry — e.g. re-posted from
          // the runs drawer) means "use the default", exactly like an absent field, not "the value is
          // null": normalise both to absent BEFORE validation, so the type checks below and the
          // destructuring defaults treat null and undefined alike (post-review fix — null used to slip
          // past `!= null` and then either reach buildPools as a literal `strLimit: null` or throw when
          // an array field's null hit code expecting an array).
          const s = Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v != null));
          const badWeapons = excludeWeaponsError(s.excludeWeapons, "settings.excludeWeapons");
          if (badWeapons) return send(res, 400, { ok: false, error: badWeapons });
          for (const f of ["excludeTags", "excludeRoots", "excludeSkills", "lockedSlots"] as const) {
            if (s[f] != null && !Array.isArray(s[f])) return send(res, 400, { ok: false, error: `settings.${f} must be an array` });
          }
          for (const f of ["allowOthersWorn", "allowGargoyle", "medOnly", "ubwsAnyWeapon"] as const) {
            if (s[f] != null && typeof s[f] !== "boolean") return send(res, 400, { ok: false, error: `settings.${f} must be a boolean` });
          }
          if (s.strLimit != null && typeof s.strLimit !== "number") return send(res, 400, { ok: false, error: "settings.strLimit must be a number" });
          const badSettingsCaps = resistCapsError(s.resistCaps, "settings.resistCaps");
          if (badSettingsCaps) return send(res, 400, { ok: false, error: badSettingsCaps });
          // Every field of `s` was checked above (when present); this cast is the trust boundary the
          // migration recipe describes — placed AFTER those checks, not instead of them. The four list
          // fields are `unknown[]` because Array.isArray() is all that ran on them: nothing looked at
          // their elements.
          const { allowOthersWorn = false, strLimit = Infinity, excludeTags = [], excludeRoots = [], allowGargoyle = false, medOnly = false, excludeWeapons = [], ubwsAnyWeapon = true, excludeSkills = [], lockedSlots = [] } = s as {
            allowOthersWorn?: boolean; strLimit?: number; excludeTags?: unknown[]; excludeRoots?: unknown[];
            allowGargoyle?: boolean; medOnly?: boolean; excludeWeapons?: string[]; ubwsAnyWeapon?: boolean; excludeSkills?: unknown[]; lockedSlots?: unknown[];
          };
          // The hand-off to buildPools() and the slot loops below need element types, and nothing above
          // established any. These casts are that gap, written down in one place: today it is harmless
          // (every use is an includes()/Set lookup or an object key, which tolerate any element), and a
          // real element check would be a behaviour change that belongs to the security review.
          const tagList = excludeTags as string[], rootList = excludeRoots as Array<string | number>, skillList = excludeSkills as string[], lockedList = lockedSlots as string[];
          const { inv } = await getInventory();
          // buildPools would happily build pools from every other character's gear and save the run
          // under a name the inventory has never seen.
          if (character && !Object.hasOwn(inv.characters, character)) return send(res, 404, { ok: false, error: `no scans for character ${JSON.stringify(character)}` });
          const pins = (pinned || {}) as Record<string, number>;
          const badPin = manualSuitError(inv, pins, "pinned");
          if (badPin) return send(res, 400, { ok: false, error: badPin });
          // a fill keeps the placed pieces in place of the locked slots: they are the only slots that keep their piece
          const keep = fill ? Object.keys(pins) : lockedList;
          const built = buildPools(inv, (character as string) || null, { allowOthersWorn: allowOthersWorn && !!character, strength: strLimit, excludeTags: tagList, excludeRoots: rootList, excludeGargoyle: !allowGargoyle, medOnly, excludeWeapons, ubwsAnyWeapon, excludeSkills: skillList, ...(fill ? { pinned: pins } : {}) });
          pools = built.pools; current = built.current; blocked = built.blocked;
          skipped = Object.fromEntries(Object.entries(built.skipped).map(([k, v]) => [k, v.length]));
          for (const slot of blocked) delete current[slot];       // a worn piece the filters now rule out must not stay "current"
          if (!fill) for (const slot of lockedList) pools[slot] = [];   // a locked slot offers no alternatives — it always keeps current
          opts = { ...(opts as RunOpts), optionalSlots: optionalSlotsFor(built.current, keep) };   // `current`, its blocked pieces deleted above
          // The saved run keeps the page's whole settings snapshot (floors, weights, race, search knobs:
          // the runs drawer labels, compares and re-applies runs from it), with the pool settings it
          // actually ran on written over it.
          meta = { ...meta, character, settings: { ...((meta.settings as Record<string, unknown> | undefined) || {}), ...s } };
        } else {
          // The hand-built form: pools/current came straight off the body, so this is where a literal
          // null candidate ({pools: {helmet: [null]}}) or an item with no props gets refused rather
          // than reaching the worker and ending the job in an internal-error ref. The by-character
          // form above builds both itself, so it needs no element check.
          const badPools = poolsError(pools) || currentError(current);
          if (badPools) return send(res, 400, { ok: false, error: badPools });
        }
        // profile is scored against in the worker; a string or a number would fail there, not here.
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) return send(res, 400, { ok: false, error: "profile required" });
        const fullOpts = Object.assign({ seed: 2026, restarts: 200 }, opts as RunOpts);
        const key = runKey({ pools, current, profile, opts: fullOpts });
        const runs = runStore.all();
        const hit = fill ? null : reusableRun(runs, key, fullOpts as { timeBudgetMs?: number });
        // §11c: warn (not block) once the candidate pool is large enough that the exact solver can
        // take a while — the page shows this line above the progress panel (Task 3).
        const poolSize = typeof meta.poolSize === "number" ? meta.poolSize : Object.values(pools).reduce((a: number, v) => a + (Array.isArray(v) ? v.length : 0), 0);
        // The by-character form doesn't hand the caller's meta a poolSize/skipped up front (unlike the
        // old form, whose client computes them itself — ui/builder.mts) — fill them in now so a saved
        // run started this way (the jobs service's saveRun() reads job.meta) carries the same figures the response does.
        if (character) { meta.poolSize = poolSize; meta.skipped = skipped; }
        if (hit) return send(res, 200, { ok: true, cached: true, run: hit, poolSize, skipped, current, blocked });
        // warm start: this character's newest saved suit, re-scored under the new settings
        const last = fill ? null : runs.find((r) => r.character === meta.character && r.result && r.result.best);
        // last.result/.best were both truthy-checked by the .find() predicate just above; `.best`'s
        // real shape is an OptAssignment-like {slot -> {serial} | null} map, looser than RunResult's
        // own declared fields (an index-signature read, same trust as everywhere else in this route).
        if (last) fullOpts.warmStart = Object.fromEntries(Object.entries(last.result!.best as Record<string, { serial: number } | null>).map(([slot, it]) => [slot, it ? it.serial : null]));
        // One running build per client, behind a server-wide ceiling (app/services/jobs.mts submit).
        const started = jobService.submit({ pools, current, profile, opts: fullOpts }, key, meta, headerClientId, !fill);
        if (!started) return send(res, 429, { ok: false, error: "too many builds are already running; try again in a moment" });
        const { job, superseded } = started;
        if (poolSize > 50000) job.meta.warning = "over 50,000 candidates; the exact solver may take a while";
        return send(res, 200, { ok: true, id: job.id, warmFrom: last ? last.id : null, superseded, warning: job.meta.warning, poolSize, skipped, current, blocked });
      }
      if (req.method === "POST" && url.pathname === "/api/runs") {
        // Save Manual's suit as a run (issue #12): {character, suit: {slot: serial}, settings, inventoryStamp}. The
        // server reads each piece and what the character wears from its own inventory (runs-lib.mts manualRun).
        const { character, suit, settings, inventoryStamp = null } = asObject(await readBody(req, { limit: 64e3 }));
        if (!isBoundedString(character, 64) || !character) return send(res, 400, { ok: false, error: "character must be a string" });
        if (!isManualSuit(suit) || !Object.keys(suit).length) return send(res, 400, { ok: false, error: "suit must map gear slots to serials, at least one" });
        if (!settings || typeof settings !== "object" || Array.isArray(settings) || JSON.stringify(settings).length > META_MAX_BYTES) return send(res, 400, { ok: false, error: "settings must be an object" });
        if (inventoryStamp != null && !isBoundedString(inventoryStamp, 256)) return send(res, 400, { ok: false, error: "inventoryStamp must be a string" });
        const badSettings = runSettingsError(settings as Record<string, unknown>);
        if (badSettings) return send(res, 400, { ok: false, error: badSettings });
        const { inv } = await getInventory();
        if (!Object.hasOwn(inv.characters, character)) return send(res, 404, { ok: false, error: `no scans for character ${JSON.stringify(character)}` });
        const badSuit = manualSuitError(inv, suit, "suit");
        if (badSuit) return send(res, 400, { ok: false, error: badSuit });
        const pieces = Object.fromEntries(Object.entries(suit).map(([slot, serial]) => [slot, toOptItem(inv.items[serial]!)]));
        const worn: Record<string, OptItem> = {};
        for (const it of Object.values(inv.items)) if (it.equippedBy === character && it.slot && GEAR_SLOTS.includes(it.slot)) worn[it.slot] ??= toOptItem(it);
        const run = manualRun({ id: randomUUID(), character, createdAt: new Date().toISOString(), settings: settings as Record<string, unknown>, inventoryStamp, suit: pieces, worn, slots: GEAR_SLOTS });
        runStore.write(run);
        eventBus.broadcast("changed", { what: "runs", at: Date.now() });
        return send(res, 200, { ok: true, run: runSummary(run) } satisfies RunBody<RunSummary>);
      }
      if (req.method === "GET" && url.pathname === "/api/runs") {
        const who = url.searchParams.get("character");
        // a run saved with twelve slots counts what its character wears in the others (runs-lib.mts totalsAfter)
        const { inv } = await getInventory(), worn = new Map<string, OptItem[]>();
        for (const it of Object.values(inv.items)) if (it.equippedBy && it.gear && it.slot) worn.set(it.equippedBy, [...(worn.get(it.equippedBy) || []), toOptItem(it)]);
        return send(res, 200, { ok: true, runs: runStore.all().filter((r) => !who || r.character === who).map((r) => runSummary(r, worn.get(r.character ?? "") || [])) } satisfies RunsListBody);
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
      if (runMatch) {
        const id = runMatch[1]!;
        if (!runStore.has(id)) return send(res, 404, { ok: false, error: "no such run" });
        // A run file that does not parse is reported for what it is — the runs store already leaves it out
        // of the list — rather than a 500 on every open; DELETE still removes it.
        const readRun = (): SavedRun | null => runStore.read(id);
        const DAMAGED_RUN = "that saved run's file is damaged and cannot be read; delete it";
        if (req.method === "GET") {
          const run = readRun();
          return run ? send(res, 200, { ok: true, run } satisfies RunBody) : send(res, 404, { ok: false, error: DAMAGED_RUN });
        }
        if (req.method === "DELETE") { runStore.remove(id); eventBus.broadcast("changed", { what: "runs", at: Date.now() }); return send(res, 200, { ok: true }); }
        if (req.method === "PUT") {
          const { label = "" } = asObject(await readBody(req, { limit: 8e3 }));
          // String() throws on an object with a null prototype or a throwing toString — a 500 plus a
          // stack for what is a one-line type check (post-review fix, Minor 13).
          if (typeof label !== "string") return send(res, 400, { ok: false, error: "label must be a string" });
          const run = readRun();
          if (!run) return send(res, 404, { ok: false, error: DAMAGED_RUN });
          run.label = label.slice(0, 120);
          runStore.write(run, id);
          return send(res, 200, { ok: true, run: runSummary(run) } satisfies RunBody<RunSummary>);
        }
      }
      const jobMatch = url.pathname.match(/^\/api\/optimize\/([\w-]+)\/(events|cancel|status)$/);
      if (jobMatch) {
        const job = jobService.get(jobMatch[1]!);
        if (!job) return send(res, 404, { ok: false, error: "no such job (the server may have restarted)" });
        if (jobMatch[2] === "cancel" && req.method === "POST") { jobService.cancel(job); return send(res, 200, { ok: true, state: job.state }); }
        if (jobMatch[2] === "status") return send(res, 200, { ok: true, ...jobService.snapshot(job) });
        if (jobMatch[2] === "events" && req.method === "GET") {
          // The events route is exempt from the bearer token (EventSource can't send one), so this
          // ownership check is what stops a different client from reading this job's progress: the
          // ?client= query param (the page's CLIENT_ID) must match the id the job was started with.
          // Both sides are required to be non-empty strings — job.clientId is never null (the POST
          // handler always assigns a real id, generating one when no X-Client-Id header was sent), but
          // this stays defense-in-depth: an absent ?client= (searchParams.get() returns null) must
          // never match a null/empty job.clientId (fixed post-review: null-clientId collision).
          const clientParam = url.searchParams.get("client");
          if (!clientParam || !job.clientId || clientParam !== job.clientId) return send(res, 403, { ok: false, error: "forbidden" });
          return streamJob(job, res);
        }
      }
      if (req.method === "GET" && url.pathname === "/api/mcp") return send(res, 200, mcpState());
      if (req.method === "PUT" && url.pathname === "/api/mcp") {
        // Settings' two switches; the port and token are not set here (the token only by POST /api/mcp/token).
        const body = asObject(await readBody(req, { limit: 8e3 }));
        const unknown = Object.keys(body).find((k) => k !== "enabled" && k !== "allowActions");
        if (unknown) return send(res, 400, { ok: false, error: `${short(unknown)} is not an MCP setting` });
        const bad = (["enabled", "allowActions"] as const).find((k) => k in body && typeof body[k] !== "boolean");
        if (bad) return send(res, 400, { ok: false, error: `${bad} must be a boolean` });
        await mcp.update(body as { enabled?: boolean; allowActions?: boolean });
        return send(res, 200, mcpState());
      }
      if (req.method === "POST" && url.pathname === "/api/mcp/token") {
        const unknown = Object.keys(asObject(await readBody(req, { limit: 8e3 })))[0];
        if (unknown) return send(res, 400, { ok: false, error: `${short(unknown)} is not a field this route takes` });
        mcp.rotateToken();
        return send(res, 200, mcpState());
      }
      if (req.method === "POST" && url.pathname === "/api/bridge") {
        // queue a command for packrat-bridge.py: {action, serial, name, chain: [root…parent], pos|null}
        const cmd = asObject(await readBody(req, { limit: 64e3, tooLargeMsg: "bridge command too large" }));
        // Cheap bounded checks in front of the schema (post-review fix, Minor 9): a 500,000-character
        // name once took queue.jsonl to half a megabyte in one request. These are loose outer bounds on
        // what is even worth assembling; the contract's own, tighter limits (name maxLength 120, chain
        // maxItems 8 — the adapters' MAX_NAME/MAX_CHAIN) are enforced by the validate() call below,
        // now that app/schema/validate.mts implements both keywords.
        if (!isBoundedString(cmd.name, 200)) return send(res, 400, { ok: false, error: "name must be a string of at most 200 characters" });
        if (cmd.chain != null && (!Array.isArray(cmd.chain) || cmd.chain.length > 16)) return send(res, 400, { ok: false, error: "chain must be an array of at most 16 serials" });
        const id = randomUUID();
        // Copy exactly the documented fields into the queue line — the page may send extras (e.g. a
        // human-readable location string) that the bridge does not need and should not carry forward.
        const line = { id, action: cmd.action, serial: cmd.serial, name: cmd.name, chain: cmd.chain || [], pos: cmd.pos ?? null, queuedAt: new Date().toISOString() };
        // Enforce the bridge contract at the only place the app writes it (post-review fix): a page
        // bug, or any other local caller, could otherwise queue a line that violates
        // BRIDGE_SCHEMA.command (unknown action, non-integer serial/chain entries, missing name) —
        // packrat-bridge.py refuses an unknown action itself, but the contract is the
        // deliverable, and it was unenforced at the only place the app writes it.
        const { ok, errors } = validate(BRIDGE_SCHEMA.command, line);
        if (!ok) return send(res, 400, { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}`, errors });
        // Queue into the CONFIGURED client's own bridge directory (appSettings.bridgeAdapter(), above) — not a
        // fixed "tazuo" — so a Razor Enhanced player's Highlight/Grab/Go-to buttons reach the bridge
        // script that's actually reading commands (Phase 6 final review follow-up).
        // pos is `object|null` in the contract with no shape of its own, so the assembled line is
        // size-checked once at the end — the only bound the field-level checks above can't give.
        const text = JSON.stringify(line) + "\n";
        if (text.length > 4096) return send(res, 400, { ok: false, error: "bridge command too large" });
        const adapter = appSettings.bridgeAdapter();
        mkdirSync(CONFIG.paths.bridgeFor(adapter), { recursive: true, mode: DATA_DIR_MODE });
        appendFileSync(CONFIG.paths.bridgeQueueFor(adapter), text, { mode: DATA_FILE_MODE });
        // A Grab is remembered like a trip (issue #148), so when it reports back the item reads as in the backpack
        // and the container it left has that slot free again (harvestTrips), until a scan says otherwise.
        if (line.action === "grab") {
          const state = organizeStateStore.read();
          organizeStateStore.write(addGrab(state, { id, adapter, serial: line.serial as number, name: line.name as string, from: (line.chain as number[]).at(-1) ?? null, queuedAt: line.queuedAt }));
        }
        return send(res, 200, { ok: true, id });
      }
      if (req.method === "POST" && url.pathname === "/api/bridge/stop") {
        // Organize's Stop: the flag packrat-bridge.py checks between the steps of a trip. No fields;
        // the body is still read so the content-type and shape checks apply like every other POST.
        asObject(await readBody(req, { limit: 8e3 }));
        writeBridgeStop(CONFIG.paths);
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/bridge/status") {
        organizeService.harvestNow(Date.now());
        const f = CONFIG.paths.bridgeStatusFor(appSettings.bridgeAdapter());
        if (!existsSync(f)) return send(res, 200, { ok: true, online: false });
        try {
          const parsed: unknown = JSON.parse(readFileSync(f, "utf8"));
          // status.json is written by the adapter's own bridge script and is hand-editable; a file that
          // parses to an array, a string or a number would otherwise be spread into the response as
          // index keys. Anything but a plain object reads as "not running".
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return send(res, 200, { ok: true, online: false });
          const st = parsed as Record<string, unknown>;
          // The bridge's "alive" timestamp is either a legacy epoch-seconds number or an RFC 3339 string
          // (new format, Task 7) — accept both, and nothing else.
          const aliveMs = typeof st.alive === "number" ? st.alive * 1000 : typeof st.alive === "string" ? Date.parse(st.alive) : NaN;
          const age = st.alive != null && !Number.isNaN(aliveMs) ? (Date.now() - aliveMs) / 1000 : Infinity;
          // The file's own fields go first, so a stray ok/online/age in a hand-edited or foreign file
          // (the bridge schema allows none of them) can never override what this server computed.
          return send(res, 200, { ...st, ok: true, online: age < 8, age: Math.round(age) });
        } catch { return send(res, 200, { ok: true, online: false }); }
      }
      if (req.method === "POST" && url.pathname === "/api/forget") {
        // A tombstone scan: a root with no items, dated now, so the fold drops everything under it.
        // Written as v2 directly (schemaVersion:2, adapter.id "app") — a plain UTC toISOString() is
        // valid RFC 3339, and now that the fold orders by epoch (parseStamp) rather than string
        // comparison of scannedAt, a UTC stamp here sorts correctly against a naive-local adapter
        // scan regardless of this machine's timezone.
        // --demo points SCANS at app/fixtures/ (repo data, committed) — Forget must never write a
        // tombstone there, or a demo session leaves a stray file in the working tree.
        if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
        // Four small scalar fields — no reason for this route to accept the 50 MB default, which is
        // what let a 200,000-character `name` become a 200 KB scan file (post-review fix, Important 4).
        const { root, name = "forgotten" } = asObject(await readBody(req, { limit: 8e3 }));
        // A non-numeric root used to pass this check (only truthiness was tested), writing a
        // tombstone whose roots[0].serial serializes to null — every later read then logs a schema
        // violation and the file accumulates forever while the user believes it worked (post-review
        // fix). root is a number or a string of decimal digits, nothing else: a bare +root coercion
        // let `true` through as serial 1, and 2**60 or "1e300" past the integer check into the
        // tombstone's own schema check, which is the 500 path. The ceiling is the scan contract's own.
        const serial = typeof root === "number" ? root : typeof root === "string" && /^\d{1,10}$/.test(root) ? Number(root) : NaN;
        if (!Number.isInteger(serial) || serial <= 0 || serial > MAX_SERIAL) return send(res, 400, { ok: false, error: "root required (positive integer serial)" });
        // `name` is the container's display label and goes straight into the document's roots[0].name,
        // which the scan contract requires to be a string — so a non-string used to write a file that
        // every later fold re-read and re-rejected ("/roots/0/name expected string"), for the life of
        // the install, while the user's Forget silently did nothing (post-review fix, Important 4).
        if (typeof name !== "string") return send(res, 400, { ok: false, error: "name must be a string" });
        const label = name.slice(0, 64).trim() || "forgotten";   // a display label, and the schema wants a non-empty one
        mkdirSync(SCANS, { recursive: true, mode: DATA_DIR_MODE });
        const stamp = new Date().toISOString();
        const snap = tombstone(stamp, appSettings.current().shard, [{ serial, kind: "ground", name: label, opened: true }]);
        // Nothing this route writes may be a file the fold then skips — check the assembled document
        // against the same contract scanStore.all() checks every file against. A failure here is this
        // app's own bug, so it takes the 500-with-a-ref path and no file is written.
        const { ok: snapOk, errors: snapErrors } = validateScan(snap);
        if (!snapOk) throw new Error(`refusing to write an invalid tombstone: ${snapErrors.map((e) => `${e.path} ${e.msg}`).join("; ")}`);
        // One file per forgotten root, not one per click: the name used to carry the millisecond
        // timestamp, so a loop of Forget calls (or a user who forgets the same container twice) grew
        // <data>/scans/ without bound and slowed every later fold, since scanStore.all() parses the whole
        // directory. Re-forgetting a root now replaces its tombstone with a newer scannedAt, which is
        // exactly what the fold wants anyway (newest scan of a root wins, by parseStamp — the file
        // name has never been what orders them).
        writeFileAtomic(join(SCANS, `_forget-${serial.toString(16)}.json`), JSON.stringify(snap), DATA_FILE_MODE);
        eventBus.broadcast("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/blacklist") return send(res, 200, { ok: true, containers: blacklistStore.read() });
      if (req.method === "POST" && url.pathname === "/api/blacklist") {
        const { serial, name, where } = asObject(await readBody(req, { limit: 8e3 }));
        if (!isBoundedInt(serial, 1, MAX_SERIAL)) return send(res, 400, { ok: false, error: "serial required (positive integer)" });
        if (typeof name !== "string" || (where !== undefined && typeof where !== "string")) return send(res, 400, { ok: false, error: "name and where must be strings" });
        const entries = blacklistStore.read();
        if (entries.some((e) => e.serial === serial)) return send(res, 200, { ok: true });
        if (entries.length >= 1000) return send(res, 409, { ok: false, error: "the blacklist is full (1000 containers)" });
        const place = where?.slice(0, 64).trim();
        entries.push({ serial, name: name.slice(0, 64).trim() || "container", addedAt: new Date().toISOString(), ...(place ? { where: place } : {}) });
        blacklistStore.write(entries);
        return send(res, 200, { ok: true });
      }
      const unlist = req.method === "DELETE" ? /^\/api\/blacklist\/(\d{1,10})$/.exec(url.pathname) : null;
      if (unlist) {
        blacklistStore.write(blacklistStore.read().filter((e) => e.serial !== Number(unlist[1])));
        return send(res, 200, { ok: true });
      }
      // The houses the scans captured (issue #10): GET /api/houses lists each with its size, chest count and container serials (what Inventory's "Show on map" looks an item's container up in), GET /api/houses/<id> serves one house's whole model. Both come from the fold's cache and the built models are memoised (houseModel); an id that names no house (or does not decode) is a 404.
      if (req.method === "GET" && (url.pathname === "/api/houses" || url.pathname.startsWith("/api/houses/"))) {
        const { inv, houses } = await getInventory();
        let one: HouseSource | undefined;
        if (url.pathname !== "/api/houses") {
          let id: string | null;
          try { id = decodeURIComponent(url.pathname.slice("/api/houses/".length)); } catch { id = null; }
          one = houses.find((h) => h.id === id);
          if (!one) return send(res, 404, { ok: false, error: "no such house" });
        }
        const from = houseService.tileData(), td = from.td, names = readNames().houses;
        const named = (id: string): { name?: string } => (names[id]?.name ? { name: names[id].name } : {});
        if (one) return send(res, 200, { ok: true, house: { ...houseService.model(inv, one, td), ...named(one.id) } } satisfies HouseApiResponse);
        return send(res, 200, { ok: true, tiledata: td !== null, tiledataFrom: { folder: from.folder, source: from.source, reason: from.reason }, houses: houses.map((h) => {
          const m = houseService.model(inv, h, td);
          return { id: h.id, ...named(h.id), facet: h.facet, capturedAt: h.capturedAt, captures: h.captures, ...plotSize(m), plot: plotBounds(m), levels: m.levels.length, containers: m.stacks.reduce((a, st) => a + st.serials.length, 0), serials: m.stacks.flatMap((st) => st.serials) };
        }) } satisfies HousesApiResponse);
      }
      // The facet overview (issue #164): GET /api/facet-map/<facet>.png?x0&y0&x1&y1[&w], the facet 0 to 5, a region in tiles (x1, y1 exclusive) and a size of at most 2048 on either side (1024 by default), never larger than the region. A region reaching past the facet is slid inside it (and cut to the facet's size), and `x-region: x0,y0,x1,y1` says which one was drawn. A 404 says why there is no image (no UO folder, the file missing or not a facet bitmap) as a reason word, never with the path.
      if (req.method === "GET" && url.pathname.startsWith("/api/facet-map/")) {
        const m = /^\/api\/facet-map\/([0-5])\.png$/.exec(url.pathname);
        if (!m) return send(res, 400, { ok: false, error: "the facet must be 0 to 5" });
        const q = url.searchParams, int = (k: string): number | null => (q.has(k) && /^\d{1,5}$/.test(q.get(k)!) ? Number(q.get(k)) : null);
        const w = q.has("w") ? int("w") : 1024;
        if (w == null || w < 1 || w > 2048) return send(res, 400, { ok: false, error: "w must be a size from 1 to 2048" });
        const [x0, y0, x1, y1] = (["x0", "y0", "x1", "y1"] as const).map(int);
        if (x0 == null || y0 == null || x1 == null || y1 == null || x0 >= x1 || y0 >= y1) return send(res, 400, { ok: false, error: "a region is x0, y0, x1 and y1, whole numbers with x0 < x1 and y0 < y1" });
        const got = houseService.facetBitmap(Number(m[1]));
        if ("reason" in got) return send(res, 404, { ok: false, reason: got.reason });
        const f = got.bitmap, slide = (a: number, b: number, max: number): [number, number] => { const span = Math.min(b - a, max), from = Math.min(a, max - span); return [from, from + span]; };
        const [rx0, rx1] = slide(x0, x1, f.width), [ry0, ry1] = slide(y0, y1, f.height), r: Region = { x0: rx0, y0: ry0, x1: rx1, y1: ry1 };
        const region = `${r.x0},${r.y0},${r.x1},${r.y1}`;
        const out = houseService.facetPng(`${got.key}|${region}|${w}`, () => { const img = renderRegion(f, r, w); return encodePng(img.width, img.height, img.rgb); });
        return send(res, 200, out, "image/png", { "x-region": region });
      }
      // The house names and areas (issues #164, #10): GET the whole map; PUT /api/house-map/<id> {name, bounds?, areas?, …}
      // replaces that house's entry (an empty name with no areas removes it). Any id of the house-id shape is taken, listed or not: a name kept for a house
      // that was redesigned or moved is what the page offers to carry over to its new id.
      if (req.method === "GET" && url.pathname === "/api/house-map") return send(res, 200, { ok: true, houses: readNames().houses });
      if (req.method === "PUT" && url.pathname.startsWith("/api/house-map/")) {
        let id: string | null;
        try { id = decodeURIComponent(url.pathname.slice("/api/house-map/".length)); } catch { id = null; }
        if (id == null || !isHouseId(id)) return send(res, 400, { ok: false, error: "that is not a house id (<facet>-<x>-<y>)" });
        const checked = checkHouseEntry(await readBody(req, { limit: MAX_ENTRY_BYTES }));
        if (!checked.ok) return send(res, 400, { ok: false, error: checked.error });
        mkdirSync(dirname(HOUSE_MAP), { recursive: true, mode: DATA_DIR_MODE });
        const refused = saveHouseEntry(HOUSE_MAP, readNames(), id, checked.entry);
        if (refused) return send(res, 409, { ok: false, error: refused });
        return send(res, 200, { ok: true, entry: checked.entry });
      }
      // The player's item kinds (issue #150): GET the whole document (the page's Classify this… and Export read it);
      // POST {name?, graphic?, kind} sets the kind for an exact item name and/or a graphic, and kind null takes those
      // entries away (Reset to automatic); POST /api/item-kinds/import {names?, graphics?} merges a file in, its
      // entries winning, and says what it left out. Every change re-kinds the inventory with no rescan (getInventory).
      if (req.method === "GET" && url.pathname === "/api/item-kinds") return send(res, 200, { ok: true, ...kindsDocument(itemKindsStore.read()) });
      if (req.method === "POST" && url.pathname === "/api/item-kinds") {
        const { name, graphic, kind } = asObject(await readBody(req, { limit: 8e3 }));
        if (name !== undefined && !(typeof name === "string" && isKindName(name))) return send(res, 400, { ok: false, error: `name must be an item name of at most ${KIND_LIMITS.name} characters` });
        if (graphic !== undefined && !isBoundedInt(graphic, 0, 0xFFFF)) return send(res, 400, { ok: false, error: "graphic must be an item graphic (0 to 65535)" });
        if (name === undefined && graphic === undefined) return send(res, 400, { ok: false, error: "name or graphic is required" });
        if (kind !== null && !OVERRIDE_KINDS.includes(kind as string)) return send(res, 400, { ok: false, error: `kind must be null or one of ${OVERRIDE_KINDS.join(", ")}` });
        const base = itemKindsStore.read(), at = { name: name as string | undefined, graphic: graphic as number | undefined };
        const next = kind === null ? withoutKinds(base, at) : withKinds(base, kindsFor(at, kind as string));
        const refused = itemKindsStore.save(next);
        if (refused) return send(res, 409, { ok: false, error: refused });
        eventBus.broadcast("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
        return send(res, 200, { ok: true, ...kindsDocument(next!) });
      }
      if (req.method === "POST" && url.pathname === "/api/item-kinds/import") {
        const body = asObject(await readBody(req, { limit: MAX_KINDS_BYTES, tooLargeMsg: "the item kinds file is too large" }));
        const { overrides, problems } = salvageKindOverrides(body);
        if (!kindCount(overrides)) return send(res, 400, { ok: false, error: `the file holds no item kinds to import${problems.length ? ` (${problems[0]})` : ""}` });
        const next = withKinds(itemKindsStore.read(), overrides);
        const refused = itemKindsStore.save(next);
        if (refused) return send(res, 409, { ok: false, error: `the import was refused: ${refused}` });
        eventBus.broadcast("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
        return send(res, 200, { ok: true, ...kindsDocument(next!), skipped: problems.length, problems: problems.slice(0, 5) });
      }
      if (req.method === "GET" && url.pathname === "/api/organize") return send(res, 200, { ok: true, ...organizeStore.read() });
      if (req.method === "PUT" && url.pathname === "/api/organize") {
        const checked = checkOrganizeConfig(await readBody(req, { limit: MAX_SETUP_BYTES, tooLargeMsg: "the Organize setup is too large" }));
        if (!checked.ok) return send(res, 400, { ok: false, error: checked.error });
        // A blacklisted container is never opened by a scan, so a label on one could only plan from stale contents.
        const black = new Set(blacklistStore.read().map((e) => e.serial));
        const listed = Object.values(checked.config.labels).find((l) => black.has(l.serial));
        if (listed) return send(res, 400, { ok: false, error: `container ${listed.serial} is blacklisted and cannot be labeled` });
        organizeStore.write(checked.config);
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/organize/presets") return send(res, 200, { ok: true, presets: PRESETS });
      if (req.method === "POST" && url.pathname === "/api/organize/match") {
        // Room for the largest filter a rule may carry (100 names, three 50-name lists, 10 tags, 20 property rules).
        const { match } = asObject(await readBody(req, { limit: 64e3 }));
        const problem = matchProblem(match);
        if (problem) return send(res, 400, { ok: false, error: problem });
        const { inv } = await getInventory();
        const counted = matchCount(inv, organizeStore.read().config, match as RuleMatch, { now: Date.now(), rarity: appSettings.rules().rarity, suitPieces: organizeService.suitsFor([match as RuleMatch]), blacklist: blacklistStore.read().map((e) => e.serial) });
        return send(res, 200, { ok: true, ...counted });
      }
      if (req.method === "POST" && url.pathname === "/api/organize/propose") {
        // Auto organize (spec §5): what a strategy would set up over the chests the player ticked (every one it ticks
        // by default when `containers` is left out). Read-only: Accept saves the proposal's config with PUT
        // /api/organize. Refused, like trips, while organize.json needed salvage: the player sees what was dropped first.
        const { strategy, containers } = asObject(await readBody(req, { limit: 64e3 }));
        if (!STRATEGY_IDS.includes(strategy as StrategyId)) return send(res, 400, { ok: false, error: `strategy must be ${STRATEGY_IDS.map((s) => `"${s}"`).join(" or ")}` });
        if (containers !== undefined && !(Array.isArray(containers) && containers.length <= LIMITS.labels && containers.every((v) => isBoundedInt(v, 1, MAX_SERIAL)))) {
          return send(res, 400, { ok: false, error: "containers must be a list of container serials" });
        }
        const { fold, config, state, problems } = await organizeService.organizeNow();
        if (problems.length) return send(res, 409, { ok: false, error: `organize.json was hand-edited and parts of it were dropped (${problems[0]}); open Organize and save the setup first` });
        const r = proposeOrganize(fold, config, state.moves, { strategy: strategy as StrategyId, containers: containers as number[] | undefined, now: Date.now(), rarity: appSettings.rules().rarity, suitPieces: organizeService.suitsFor(config.rules.map((r) => r.match)), blacklist: blacklistStore.read().map((e) => e.serial), seen: state.seen });
        return send(res, r.ok ? 200 : 409, r satisfies ProposeResult);
      }
      if (req.method === "GET" && url.pathname === "/api/organize/plan") {
        // `running`: the trip in flight, if any, so a page reloaded (or opened in a second window) mid-trip follows it.
        const { state, plan, bridges } = await organizeService.organizeNow();
        const p = state.pending[0];
        return send(res, 200, { ok: true, plan, running: p ? { id: p.id, index: p.index, queuedAt: p.queuedAt, picked: bridges[p.adapter]?.current === p.id } : null } satisfies OrganizePlanApiResponse);
      }
      if (req.method === "POST" && url.pathname === "/api/organize/trip") {
        // One trip of the CURRENT plan, built here and queued with queueTrip: the page names the trip and the plan it
        // was shown (stamp), never the moves. A plan that changed since — a new scan, an edited rule, a trip that
        // reported back and renumbered the rest — is refused, and so is any trip but its site's first, which may
        // count on room an earlier trip makes.
        const { index, stamp } = asObject(await readBody(req, { limit: 8e3 }));
        if (!isBoundedInt(index, 1, 10000) || !isBoundedString(stamp, 64)) return send(res, 400, { ok: false, error: "index (a trip number) and stamp (the plan's) are required" });
        const adapter = appSettings.bridgeAdapter();
        if (!setupService.runsTrips(adapter)) return send(res, 409, { ok: false, error: `the ${adapter} bridge cannot run Organize trips` });
        const { fold, state, plan, problems } = await organizeService.organizeNow();
        // A salvaged setup lost rules or targets, and their items may now fall through to another rule or the
        // catch-all: nothing moves until the player has seen that and saved the setup again.
        if (problems.length) return send(res, 409, { ok: false, error: `organize.json was hand-edited and parts of it were dropped (${problems[0]}); open Organize and save the setup first` });
        const waiting = state.pending[0];
        if (waiting) return send(res, 409, { ok: false, error: `trip ${waiting.index} has not reported back yet` });
        if (stamp !== plan.stamp) return send(res, 409, { ok: false, error: "the plan has changed since it was shown; reload it", stamp: plan.stamp });
        const trip = plan.trips.find((t) => t.index === index);
        if (!trip) return send(res, 404, { ok: false, error: `the plan has no trip ${index}` });
        const first = plan.trips.find((t) => t.site === trip.site)!;
        if (first.index !== index) return send(res, 409, { ok: false, error: `run trip ${first.index} first: this trip counts on the room it makes` });
        const queued = organizeService.queuePlanTrip(adapter, fold, state, plan, index);
        if (!queued.ok) return send(res, 409, { ok: false, error: queued.error });
        return send(res, 200, { ok: true, id: queued.id, index });
      }
      if (req.method === "POST" && url.pathname === "/api/forget-character") {
        // A character tombstone: a `_vault` scan naming the character in `forgetCharacter`, which the
        // fold (vault-lib.mts's forgetCharacter) handles by dropping the character's card, worn set,
        // backpack and bank. Same demo refusal and validate-before-write rule as /api/forget above.
        if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
        const { character } = asObject(await readBody(req, { limit: 8e3 }));
        if (!isBoundedString(character, 64) || isPseudoCharacter(character)) return send(res, 400, { ok: false, error: "character required (a scanned character's name)" });
        // Only a character the inventory has: a tombstone per arbitrary name would pile up in scans/.
        if (!Object.hasOwn((await getInventory()).inv.characters, character)) return send(res, 404, { ok: false, error: `no scanned character named ${short(character)}` });
        mkdirSync(SCANS, { recursive: true, mode: DATA_DIR_MODE });
        const snap = tombstone(new Date().toISOString(), appSettings.current().shard, [], character);
        const { ok: snapOk, errors: snapErrors } = validateScan(snap);
        if (!snapOk) throw new Error(`refusing to write an invalid tombstone: ${snapErrors.map((e) => `${e.path} ${e.msg}`).join("; ")}`);
        // One file per forgotten character (hex of the name: any name is a safe file name that way),
        // replaced with a newer stamp if the character is forgotten again.
        writeFileAtomic(join(SCANS, `_forget-char-${Buffer.from(character).toString("hex")}.json`), JSON.stringify(snap), DATA_FILE_MODE);
        eventBus.broadcast("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
        return send(res, 200, { ok: true });
      }
      send(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      if (e && (e as HttpError).statusCode) {
        const status = (e as HttpError).statusCode!;
        // A 413 means the upload was refused: readBody kept nothing past the cap and only rejects once
        // the request has ended (or, past OVERFLOW_DRAIN_BYTES of overflow, destroys the socket), and
        // `connection: close` retires the connection once the refusal is on the wire (post-review fix,
        // Minor 7). Waiting for the end is what lets a client that was still writing its body read this
        // 413 at all. Node merges this header with the ones send() passes to writeHead().
        if (status === 413) res.setHeader("connection", "close");
        return send(res, status, { ok: false, error: (e as HttpError).message });
      }
      // Stack-free 500 (spec §4.5): the client gets a short ref, never the stack; the stack goes to
      // the log file keyed by that same ref, so a bug report only needs the ref to be actionable.
      const ref = randomUUID().slice(0, 8);
      safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} ${ref} ${req.method} ${url.pathname}\n${(e && (e as Error).stack) || e}\n`);
      send(res, 500, { ok: false, error: "internal error", ref });
    }
  });

  // Both of these used to be 0 (disabled), justified by "exact searches can legitimately run for
  // minutes" — but that is about the RESPONSE side, which neither of them governs: requestTimeout is
  // the ceiling on RECEIVING a request, and headersTimeout the ceiling on receiving its headers, so a
  // socket that sent half a request line and then stopped was never closed at all (post-review fix,
  // Minor 7 — slowloris). Node's own defaults are the right values here. Probe-verified that an SSE
  // response outlives requestTimeout: the request itself completed on connect, so no per-route
  // exemption is needed for GET /api/events or the per-job optimize stream. server.timeout (the idle
  // socket timeout, which WOULD cut a long-lived stream) stays disabled.
  server.requestTimeout = 300_000; server.headersTimeout = 60_000; server.timeout = 0;
  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error) => { server.off("listening", onListening); reject(e); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(CONFIG.port, "127.0.0.1");
  });
  startWatchers();
  await mcp.start();
  retentionService.prune("startup").catch((e: Error) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} retention (startup) failed: ${e.stack || e.message}\n`));
  const port = (server.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  console.log(`Pack Rat: ${url}  (data: ${CONFIG.dataDir})  token: ${CONFIG.token ? "set" : "none (dev)"}`);
  if (CONFIG.open) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  }
  return {
    server, port, url,
    close: () => mcp.close().then(() => new Promise<void>((ok) => {
      for (const t of timers) clearTimeout(t);   // clearTimeout also clears intervals (same id space)
      timers.clear();
      // closing first: a build still running when the server quits ends because of the quit, and its
      // worker's exit must not be logged as an internal error with a ref (a phantom crash in every
      // server.log attached to a bug report after a quit mid-build).
      jobService.stop();
      for (const w of watchers.values()) w.close();
      // server.close() waits for every connection "waiting for a response" — an attached SSE stream
      // is one, and would otherwise hold teardown open until its keep-alive idle timeout. End every
      // open stream (both the per-job optimize streams and the shared /api/events stream) and
      // force-close the sockets so close() resolves promptly.
      jobService.endStreams();
      eventBus.close();
      server.closeAllConnections();
      // ok's declared parameter type (void | PromiseLike<void>) is narrower than server.close()'s own
      // callback type (err?: Error) — this server always calls it with no error at this point in a
      // controlled shutdown, so passing the SAME function through an erased cast changes nothing at
      // runtime.
      server.close(ok as (err?: Error) => void);
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await startServer(); } catch (e) { console.error((e as Error).message); process.exit(2); }
}
