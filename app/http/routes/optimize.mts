// optimize.mts — the Suit Builder's builds and saved runs: POST /api/optimize, the per-job /api/optimize/<id>/events|cancel|status, POST|GET /api/runs and GET|PUT|DELETE /api/runs/<id>, and POST /api/evaluate.
//
// The routes, what each takes and answers:
// - `POST /api/optimize` {pools,current,profile,opts} -> {id}, or {character,settings,profile,opts} to have the server build the pools itself (buildPools, per-slot lockedSlots/blocked handling, in app/services/builds.mts; with `pinned`, Manual's suit {slot: serial}, it fills only the empty slots, for a character or none, and is never saved as a run; `character: "_nobody"`, the Suit Builder's No character, builds from the pieces nobody wears like a fill with no character, but is saved and reused as a run under `_nobody`); either form's response carries poolSize/skipped/current/blocked/warning?
// - `GET /api/optimize/<id>/events` (SSE: hello, progress, done|failed|cancelled)
// - `POST /api/optimize/<id>/cancel`
// - `GET /api/optimize/<id>/status`
// - A POST /api/optimize whose inputs match a saved run that cannot be bettered returns {cached: true, run} at once.
// - `GET /api/runs?character=` (saved runs, newest first; `?character=_nobody` lists No character's)
// - `GET|PUT {label}|DELETE /api/runs/<id>` (GET adds `gearChanges` for a run that kept its pool: the pieces its pool, rebuilt from its settings against the scans now, takes that it did not, and the suit's pieces that moved or are gone; issue #291)
// - `POST /api/runs` {character, suit, settings, inventoryStamp} (save Manual's suit as a run, method "manual"; `_nobody` saves No character's, with nothing worn)
// - `POST /api/evaluate` {character (null or `"_nobody"`: No character), suit, profile?, buffs?} (a hand-picked suit evaluated as Manual evaluates it, `app/evaluate.mts`: gear totals, effective totals with the buffs, caps, waste and requirements; `profile` is a run's settings snapshot, the character's saved profile without it)
//
// map: server
// owns: `routes`
import { randomUUID } from "node:crypto";
import http from "node:http";
import { isBoundedInt, isBoundedString, short } from "../../guards.mts";
import { givenSettings, manualSuitError, poolOptions, scannedWho } from "../../services/builds.mts";
import { scoreShares, type DiagnosticsProfile } from "../../diagnostics.mts";
import { readBody } from "../../read-body.mts";
import { gearChanges, runSummary, manualRun, poolSerials, type RunOpts, type SavedRun } from "../../runs-lib.mts";
import { OPTS_LIMITS, runSettingsError, type RunSettings } from "../../run-settings.mts";
import { manualBase, manualPlan } from "../../buffs.mts";
import { evaluateSuit } from "../../evaluate.mts";
import type { GearChanges, RunBody, RunsListBody, RunSummary, ScoreShare } from "../../runs-types.mts";
import type { EvaluateApiResponse, OptimizeCancelApiResponse, OptimizeStatusApiResponse } from "../../api/optimize.mts";
import type { OkApiResponse } from "../../api/routes.mts";
import { sse } from "../../services/events.mts";
import type { Job } from "../../services/jobs.mts";
import { GEAR_SLOTS, GOAL_RANKS_MAX, GOAL_RANK_SIZE_MAX, NOBODY, RARITY_PREFERENCES, RESIST_KEYS, buildPools, toOptItem, totalsOf, type Character, type Item, type OptItem, type Profile, type RarityPreference, type RunBuffs } from "../../vault-lib.mts";
import { characterProfile, planBuild, specFromRunSettings, isManualSuit } from "../../build-spec.mts";
import { safeAppendLog } from "../../log.mts";
import { stepsFor } from "../../swing.mts";
import { send, asObject, SSE_HEADERS } from "../respond.mts";
import { NEXT, type Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

// ---- POST /api/optimize's request shape ---------------------------------------------------------
// Everything below this comment runs on a body any local caller can send. Until this pass the route
// checked `profile` for truthiness and nothing else, so a malformed pools entry reached the worker
// thread and ended the job in an internal-error ref with a full stack in the log — an attacker-driven
// path into the unrotated log file, and a confusing failure for a page bug (post-review fix,
// Important 5). Every helper here returns the reason it refused (for a 400) or null.

// One optimizer candidate: vault-lib's OptItem, {serial, name, slot, props}. The core reads `.props`
// off every entry with no null guard of its own, keys candidates and changes by `.serial`, names a change
// by `.name` and offers a piece only in the slot its `.slot` names, so a piece missing any of them (or
// with a property that is not a number) can't be searched as sent and is refused here. A worn piece
// goes back in the start answer's `current` as it came, so this is also what keeps that answer an OptItem.
function optItemError(it: unknown): string | null {
  if (!it || typeof it !== "object" || Array.isArray(it)) return "every candidate must be an object";
  const { serial, name, slot, props } = it as Record<string, unknown>;
  if (!props || typeof props !== "object" || Array.isArray(props)) return "every candidate needs a props object";
  if (typeof serial !== "number" || !Number.isFinite(serial)) return "every candidate needs a numeric serial";
  if (typeof name !== "string") return "every candidate needs a name";
  if (slot !== null && typeof slot !== "string") return "every candidate needs a slot (a string, or null)";
  for (const [k, v] of Object.entries(props)) if (typeof v !== "number" || !Number.isFinite(v)) return `props.${short(k)} must be a number`;
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
// current is the worn suit: slot -> candidate, or null/absent for an empty slot. The game never wears a two-handed weapon
// beside a one-hander, and only the core empties the one-hand slot under one (optSanitize); the MIP reads `current` as
// it is, so a hand-built suit wearing both is refused here, as Manual's Fill is (services/builds.mts's manualSuitError).
function currentError(current: unknown): string | null {
  if (!current || typeof current !== "object" || Array.isArray(current)) return "current must be an object";
  for (const [slot, it] of Object.entries(current as Record<string, unknown>)) {
    if (it == null) continue;
    const e = optItemError(it); if (e) return `current.${short(slot)}: ${e}`;
  }
  const { oneHanded, twoHanded } = current as Record<string, { twoHanded?: unknown } | null | undefined>;
  if (twoHanded?.twoHanded === true && oneHanded != null) return "current: a two-handed weapon leaves the one-hand slot empty";
  return null;
}
// The search options a caller may set, and the range each one may sit in (app/run-settings.mts OPTS_LIMITS). An
// allowlist rather than a shape check, so an unknown key is refused rather than handed to the solver — which also means
// an own `__proto__` key out of JSON.parse never reaches the Object.assign that builds fullOpts.
// optionalSlots and warmStart are set after this runs by services/builds.mts: optionalSlots for the character and fill
// forms only (a hand-built request keeps the core's default optional slots), warmStart from the last run with the same
// key. seed/restarts/timeBudgetMs/exact/alternatives are what app/ui/builder.mts actually sends.
export { OPTS_LIMITS };
// A profile's Resisting Spells steps (vault-lib.mts EffectiveProfile.resistSteps) as both solvers read them alike: each
// `at` a bonus in (0, 1000], strictly increasing, and every step's `mins` a finite number for every resist.
function resistStepsValid(steps: unknown): boolean {
  if (!Array.isArray(steps)) return false;
  let last = 0;
  return steps.every((st) => {
    if (!st || typeof st !== "object") return false;
    const { at, mins } = st as { at?: unknown; mins?: unknown };
    if (typeof at !== "number" || !Number.isFinite(at) || at <= last || at > 1000 || !mins || typeof mins !== "object") return false;
    last = at;
    return RESIST_KEYS.every((k) => Number.isFinite((mins as Record<string, unknown>)[k]));
  });
}
const OPTS_MAX_TIME_BUDGET_MS = OPTS_LIMITS.timeBudgetMs.max;
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
      case "tieBreak": {
        if (!v || typeof v !== "object" || Array.isArray(v)) return "opts.tieBreak must be an object";
        // a rarity preference, the fewest changes (issue #292), or both
        const { rarity, tolerance, fewestChanges, ...extra } = v as Record<string, unknown>;
        if (rarity != null && !RARITY_PREFERENCES.includes(rarity as RarityPreference)) return `opts.tieBreak.rarity must be one of ${RARITY_PREFERENCES.join(", ")}`;
        if (fewestChanges != null && typeof fewestChanges !== "boolean") return "opts.tieBreak.fewestChanges must be a boolean";
        if (rarity == null && !fewestChanges) return "opts.tieBreak needs a rarity or fewestChanges";
        if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) return "opts.tieBreak.tolerance must be a non-negative number";
        if (Object.keys(extra).length) return `opts.tieBreak.${short(Object.keys(extra)[0]!)} is not a tie-break setting`;
        break;
      }
      case "strict": {
        // strict order (issue #292): the goal ranks, most important first, each a list of property keys
        const { ranks, fewestChanges, ...extra } = (v && typeof v === "object" && !Array.isArray(v) ? v : { ranks: null }) as Record<string, unknown>;
        if (fewestChanges != null && typeof fewestChanges !== "boolean") return "opts.strict.fewestChanges must be a boolean";
        if (!Array.isArray(ranks) || ranks.length > GOAL_RANKS_MAX || !ranks.every((r) => Array.isArray(r) && r.length > 0 && r.length <= GOAL_RANK_SIZE_MAX && r.every((k) => isBoundedString(k, 64))))
          return `opts.strict.ranks must be a list of at most ${GOAL_RANKS_MAX} ranks, each a list of 1 to ${GOAL_RANK_SIZE_MAX} property names`;
        if (Object.keys(extra).length) return `opts.strict.${short(Object.keys(extra)[0]!)} is not a strict-order setting`;
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

export function routes(ctx: ServerContext): Route[] {
  const { buildsService, eventBus, getInventory, jobService, profilesStore, runStore, timers } = ctx;
  function streamJob(job: Job, res: http.ServerResponse): void {
    res.writeHead(200, SSE_HEADERS);
    sse(res, "hello", jobService.snapshot(job));   // catch-up: last progress, or the final outcome if it already ended
    if (job.state !== "running") { res.end(); return; }
    job.clients.add(res);
    const ping = setInterval(() => sse(res, "ping", { at: Date.now() }), 5000);
    ping.unref(); timers.add(ping);
    res.on("close", () => { clearInterval(ping); timers.delete(ping); job.clients.delete(res); });
  }
  // A saved run's gear changes (issue #291): its pool rebuilt from its settings, at the STR limit it was built with, against
  // the scans now, compared with the pool it kept. A rebuild that fails is logged and gives none (the plain banner).
  async function gearChangesOf(run: SavedRun): Promise<GearChanges | null> {
    if (!run.poolSerials) return null;
    const { inv } = await getInventory();
    return gearChanges(run, inv, () => {
      const { pool, poolOpts } = poolOptions(inv, run.character!, givenSettings(run.settings));
      const built = buildPools(inv, scannedWho(run.character!), { ...poolOpts, ...(typeof run.poolStrength === "number" ? { strength: run.poolStrength } : {}), onlyRoots: pool.onlyRoots });
      return poolSerials(built.pools, built.current);
    }, (e) => safeAppendLog(ctx.config.paths.log, `${new Date().toISOString()} run ${run.id} gear changes failed, shown without them: ${String((e as Error)?.stack || e)}\n`));
  }
  return [
    { method: "POST", path: "/api/optimize", handle: async (req, res) => {
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
      // The settings snapshot the saved run keeps (the runs drawer labels, compares and reopens runs from it) and the
      // pool settings: held to the one rule a manual run's settings are (app/run-settings.mts).
      const badSettings = runSettingsError(meta.settings, "meta.settings") || runSettingsError(settings, "settings");
      if (badSettings) return send(res, 400, { ok: false, error: badSettings });
      // The by-character form: the caller sends {character, settings} instead of building pools/current
      // itself, and the server runs buildPools() against the cached inventory — the same function and
      // the same defaults the page's own optimizerProfile() uses (ui/builder.mts), so a request built
      // this way and an equivalent hand-built {pools,current} request key identically (the run key, app/solver/prepare.mts) and
      // reuse each other's saved runs.
      // character names a folded inventory key and lands in a saved run's own `character` field —
      // truthy-checked only, until this pass (see report).
      if (character != null && !isBoundedString(character, 64)) return send(res, 400, { ok: false, error: "character must be a string" });
      // Manual's "Fill the rest automatically" (issue #12): `pinned` is Manual's suit, {slot: serial}. Each piece is
      // kept in its slot (buildPools), the search fills only the empty slots, and with no character the pool is the
      // pieces nobody wears. A fill is never saved as a run, nor answered by one.
      if (pinned != null && !isManualSuit(pinned)) return send(res, 400, { ok: false, error: "pinned must map gear slots to serials" });
      const fill = pinned != null;
      if (!character && !fill) {
        // The hand-built form: pools/current came straight off the body, so this is where a literal
        // null candidate ({pools: {helmet: [null]}}) or an item with no props gets refused rather
        // than reaching the worker and ending the job in an internal-error ref. The by-character
        // form and a fill build both on the server (app/services/builds.mts), so they need no element check.
        const badPools = poolsError(pools) || currentError(current);
        if (badPools) return send(res, 400, { ok: false, error: badPools });
      }
      // profile is scored against in the worker; a string or a number would fail there, not here.
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) return send(res, 400, { ok: false, error: "profile required" });
      const { hardFloors } = profile as { hardFloors?: unknown };
      if (hardFloors != null && (!Array.isArray(hardFloors) || hardFloors.some((k) => !isBoundedString(k, 64)))) return send(res, 400, { ok: false, error: "profile.hardFloors must be an array of property names" });
      const { resistSteps } = profile as { resistSteps?: unknown };
      if (resistSteps != null && !resistStepsValid(resistSteps)) return send(res, 400, { ok: false, error: "profile.resistSteps must be an array of {at, mins}: at in (0, 1000] and strictly increasing, mins a finite number for every resist" });
      // a hard floor's shared partial credit stays under half its bonus only up to 0.5 (mip.mts hardFloorSpread); the page
      // and MCP never send one, so this is a hand-built request's field
      const { floorPartial, floorBonus } = profile as { floorPartial?: unknown; floorBonus?: unknown };
      // a soft floor's bonus rewards reaching it: a negative one has no use, and the exact solver has no model for it (issue #315)
      if (floorBonus != null && (typeof floorBonus !== "number" || !Number.isFinite(floorBonus) || floorBonus < 0 || floorBonus > 1e6)) return send(res, 400, { ok: false, error: "profile.floorBonus must be a number from 0 to 1000000" });
      if (floorPartial != null && (typeof floorPartial !== "number" || !Number.isFinite(floorPartial) || floorPartial < 0 || floorPartial > 0.5)) return send(res, 400, { ok: false, error: "profile.floorPartial must be a number from 0 to 0.5" });
      // the pool, the prepared solve, a saved run that answers it or the started job (app/services/builds.mts)
      const { status, body: answer } = await buildsService.start({ pools, current, profile, opts: opts as RunOpts, meta, character: (character as string | null) || null, settings, pinned: (pinned as Record<string, number> | null | undefined) ?? null }, headerClientId);
      return send(res, status, answer);
    } },
    { method: "POST", path: "/api/runs", handle: async (req, res) => {
      // Save Manual's suit as a run (issue #12): {character, suit: {slot: serial}, settings, inventoryStamp}. The
      // server reads each piece and what the character wears from its own inventory (runs-lib.mts manualRun).
      const { character, suit, settings, inventoryStamp = null } = asObject(await readBody(req, { limit: 64e3 }));
      if (!isBoundedString(character, 64) || !character) return send(res, 400, { ok: false, error: "character must be a string" });
      if (!isManualSuit(suit) || !Object.keys(suit).length) return send(res, 400, { ok: false, error: "suit must map gear slots to serials, at least one" });
      if (!settings || typeof settings !== "object" || Array.isArray(settings) || JSON.stringify(settings).length > META_MAX_BYTES) return send(res, 400, { ok: false, error: "settings must be an object" });
      if (inventoryStamp != null && !isBoundedString(inventoryStamp, 256)) return send(res, 400, { ok: false, error: "inventoryStamp must be a string" });
      const badSettings = runSettingsError(settings, "settings");
      if (badSettings) return send(res, 400, { ok: false, error: badSettings });
      const { inv } = await getInventory();
      // No character's run (NOBODY) wears nothing
      if (character !== NOBODY && !Object.hasOwn(inv.characters, character)) return send(res, 404, { ok: false, error: `no scans for character ${JSON.stringify(character)}` });
      const badSuit = manualSuitError(inv, suit, "suit");
      if (badSuit) return send(res, 400, { ok: false, error: badSuit });
      const pieces = Object.fromEntries(Object.entries(suit).map(([slot, serial]) => [slot, toOptItem(inv.items[serial]!)]));
      const worn: Record<string, OptItem> = {};
      for (const it of Object.values(inv.items)) if (it.equippedBy === character && it.slot && GEAR_SLOTS.includes(it.slot)) worn[it.slot] ??= toOptItem(it);
      // what made up its score, planned as build_suit plans a hand-picked suit, with SSI by step as a search would score it (optimize-worker.mts); a failure saves the run without it
      let shares: ScoreShare[] | undefined;
      try {
        const c = character === NOBODY ? null : inv.characters[character] as Character, totals = totalsOf(pieces), stam = totals.stamPool || 0;
        const items: Record<string, Item> = Object.fromEntries(Object.entries(suit).map(([slot, serial]) => [slot, inv.items[serial]!]));
        const { profile } = planBuild(specFromRunSettings(settings as RunSettings), { character: c, worn: Object.values(inv.items).filter((it) => it.equippedBy === character), race: (settings as Profile).race, suit: items });
        const { ssiSteps } = stepsFor(profile, Object.fromEntries(Object.entries(pieces).map(([slot, it]) => [slot, [it]])), pieces, { min: stam, max: stam }, undefined, totals.ssi || 0);
        shares = scoreShares((ssiSteps ? { ...profile, ssiSteps } : profile) as DiagnosticsProfile, totals);
      } catch (e) { safeAppendLog(ctx.config.paths.log, `${new Date().toISOString()} manual run shares failed, saved without them: ${String((e as Error)?.stack || e)}\n`); }
      const run = manualRun({ id: randomUUID(), character, createdAt: new Date().toISOString(), settings: settings as Record<string, unknown>, inventoryStamp, suit: pieces, worn, slots: GEAR_SLOTS, shares });
      runStore.write(run);
      eventBus.broadcast("changed", { what: "runs", at: Date.now() });
      return send(res, 200, { ok: true, run: runSummary(run) } satisfies RunBody<RunSummary>);
    } },
    { method: "POST", path: "/api/evaluate", handle: async (req, res) => {
      // A suit evaluated as Manual evaluates it (app/evaluate.mts): {character (null: No character), suit: {slot:
      // serial}, profile?, buffs?}. `profile` is a run's settings snapshot (floors, softFloors, weights, race,
      // resistCaps), checked like one; without it, the character's saved profile. `buffs` is a run's {on, skills}, else
      // the profile's; Enhance Potions and Spell Channeling are read from the suit.
      const { character: asked, suit, profile, buffs } = asObject(await readBody(req, { limit: 64e3 }));
      const character = asked === NOBODY ? null : asked;   // No character's pseudo name evaluates as null does
      if (character !== null && (!isBoundedString(character, 64) || !character)) return send(res, 400, { ok: false, error: "character must be a string, or null for No character" });
      if (!isManualSuit(suit)) return send(res, 400, { ok: false, error: "suit must map gear slots to serials" });
      const bad = runSettingsError(profile, "profile") || runSettingsError(buffs == null ? null : { buffs }, "body");
      if (bad) return send(res, 400, { ok: false, error: bad });
      const { inv } = await getInventory();
      if (character && !Object.hasOwn(inv.characters, character)) return send(res, 404, { ok: false, error: `no scans for character ${JSON.stringify(character)}` });
      const badSuit = manualSuitError(inv, suit, "suit");
      if (badSuit) return send(res, 400, { ok: false, error: badSuit });
      const saved = characterProfile(await profilesStore.read(), character ?? "", profilesStore.builtins());
      const p = (profile ?? saved) as Profile & { buffs?: RunBuffs }, b = (buffs ?? p.buffs) as RunBuffs | undefined;
      const c = character ? inv.characters[character] as Character : null, pieces: Record<string, Item> = Object.fromEntries(Object.entries(suit).map(([slot, serial]) => [slot, inv.items[serial]!]));
      const worn = character ? Object.values(inv.items).filter((it) => it.equippedBy === character) : [];
      const evaluation = evaluateSuit({ profile: manualBase(p, c), character: c, suit: Object.fromEntries(Object.entries(pieces).map(([slot, it]) => [slot, toOptItem(it)])),
        buffs: manualPlan(c, worn, pieces, c ? p.race || "human" : null, b?.on ?? [], b?.skills ?? {}) });
      return send(res, 200, { ok: true, evaluation } satisfies EvaluateApiResponse);
    } },
    { method: "GET", path: "/api/runs", handle: async (_req, res, url) => {
      const who = url.searchParams.get("character");
      // a run saved with twelve slots counts what its character wears in the others (runs-lib.mts totalsAfter)
      const { inv } = await getInventory(), worn = new Map<string, OptItem[]>();
      for (const it of Object.values(inv.items)) if (it.equippedBy && it.gear && it.slot) worn.set(it.equippedBy, [...(worn.get(it.equippedBy) || []), toOptItem(it)]);
      return send(res, 200, { ok: true, runs: runStore.all().filter((r) => !who || r.character === who).map((r) => runSummary(r, worn.get(r.character ?? "") || [])) } satisfies RunsListBody);
    } },
    { method: "*", path: /^\/api\/runs\/([\w-]+)$/, handle: async (req, res, _url, runMatch) => {
      const id = runMatch[1]!;
      if (!runStore.has(id)) return send(res, 404, { ok: false, error: "no such run" });
      // A run file that does not parse is reported for what it is — the runs store already leaves it out
      // of the list — rather than a 500 on every open; DELETE still removes it.
      const readRun = (): SavedRun | null => runStore.read(id);
      const DAMAGED_RUN = "that saved run's file is damaged and cannot be read; delete it";
      if (req.method === "GET") {
        const run = readRun();
        if (!run) return send(res, 404, { ok: false, error: DAMAGED_RUN });
        const gear = await gearChangesOf(run);
        // the kept pool answers gearChanges; the page never reads it
        const { poolSerials: _serials, picked: _picked, poolStrength: _strength, ...shown } = run;
        return send(res, 200, { ok: true, run: shown, ...(gear ? { gearChanges: gear } : {}) } satisfies RunBody);
      }
      if (req.method === "DELETE") { runStore.remove(id); eventBus.broadcast("changed", { what: "runs", at: Date.now() }); return send(res, 200, { ok: true } satisfies OkApiResponse); }
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
      return NEXT;
    } },
    { method: "*", path: /^\/api\/optimize\/([\w-]+)\/(events|cancel|status)$/, handle: (req, res, url, jobMatch) => {
      const job = jobService.get(jobMatch[1]!);
      if (!job) return send(res, 404, { ok: false, error: "no such job (the server may have restarted)" });
      if (jobMatch[2] === "cancel" && req.method === "POST") { jobService.cancel(job); return send(res, 200, { ok: true, state: job.state } satisfies OptimizeCancelApiResponse); }
      if (jobMatch[2] === "status") return send(res, 200, { ok: true, ...jobService.snapshot(job) } satisfies OptimizeStatusApiResponse);
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
      return NEXT;
    } },
  ];
}
