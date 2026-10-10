// optimize.mts — the Suit Builder's builds and saved runs: POST /api/optimize, the per-job /api/optimize/<id>/events|cancel|status, POST|GET /api/runs and GET|PUT|DELETE /api/runs/<id>, and POST /api/evaluate.
import { randomUUID } from "node:crypto";
import http from "node:http";
import { isBoundedInt, isBoundedString, short } from "../../guards.mts";
import { optionalSlotsFor } from "../../mip.mts";
import { onlyRootsDiagnostics, preBuildDiagnostics, weaponFlagDiagnostics, type Diagnostic, type DiagnosticsProfile } from "../../diagnostics.mts";
import { readBody } from "../../read-body.mts";
import { runKey, reusableRun, runSummary, manualRun, type RunOpts, type SavedRun } from "../../runs-lib.mts";
import { OPTS_LIMITS, RUN_DEFAULTS, runSettingsError, type RunSettings } from "../../run-settings.mts";
import { manualBase, manualPlan } from "../../buffs.mts";
import { evaluateSuit } from "../../evaluate.mts";
import type { RunBody, RunsListBody, RunSummary } from "../../runs-types.mts";
import { sse } from "../../services/events.mts";
import type { Job } from "../../services/jobs.mts";
import { isManualSuit } from "../../store/ui-prefs.mts";
import { rarityRank } from "../../item-query.mts";
import type { RulesV1RarityItem } from "../../schema/types.d.mts";
import { GEAR_SLOTS, NOBODY, RARITY_PREFERENCES, buildPools, getRules, missingFlags, toOptItem, type Character, type Inventory, type Item, type OptItem, type Profile, type RarityPreference, type RunBuffs } from "../../vault-lib.mts";
import { characterProfile, poolFromSpec, specFromRunSettings } from "../../build-spec.mts";
import { send, asObject, SSE_HEADERS } from "../respond.mts";
import { NEXT, type Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

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
// The search options a caller may set, and the range each one may sit in (app/run-settings.mts OPTS_LIMITS). An
// allowlist rather than a shape check, so an unknown key is refused rather than handed to the solver — which also means
// an own `__proto__` key out of JSON.parse never reaches the Object.assign that builds fullOpts.
// optionalSlots/warmStart are set by the route itself after this runs; seed/restarts/timeBudgetMs/
// exact/alternatives are what app/ui/builder.mts actually sends.
export { OPTS_LIMITS };
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
        const { rarity, tolerance, ...extra } = v as Record<string, unknown>;
        if (!RARITY_PREFERENCES.includes(rarity as RarityPreference)) return `opts.tieBreak.rarity must be one of ${RARITY_PREFERENCES.join(", ")}`;
        if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) return "opts.tieBreak.tolerance must be a non-negative number";
        if (Object.keys(extra).length) return `opts.tieBreak.${short(Object.keys(extra)[0]!)} is not a tie-break setting`;
        break;
      }
      default: return `opts.${short(k)} is not a supported search option`;
    }
  }
  return null;
}
// A rarity preference's per-piece cost (issue #262), stamped on each candidate and worn piece: the solvers minimize its
// sum among suits within the tolerance. "lower" costs a piece its rank on the shard's ladder, "higher" the ranks above
// it (an empty slot costs 0 either way); a serial the scans do not have ranks 0, below every tier.
function stampTieCost<T extends { serial: number }>(it: T, inv: Inventory, rarity: RarityPreference, ladder: RulesV1RarityItem[]): T & { tieCost: number } {
  const rank = rarityRank(ladder, inv.items[it.serial]?.rarity);
  return { ...it, tieCost: rarity === "lower" ? rank : ladder.length - rank };
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
  const { eventBus, getInventory, jobService, profilesStore, runStore, timers } = ctx;
  function streamJob(job: Job, res: http.ServerResponse): void {
    res.writeHead(200, SSE_HEADERS);
    sse(res, "hello", jobService.snapshot(job));   // catch-up: last progress, or the final outcome if it already ended
    if (job.state !== "running") { res.end(); return; }
    job.clients.add(res);
    const ping = setInterval(() => sse(res, "ping", { at: Date.now() }), 5000);
    ping.unref(); timers.add(ping);
    res.on("close", () => { clearInterval(ping); timers.delete(ping); job.clients.delete(res); });
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
      let skipped: Record<string, number> = {}, blocked: string[] = [], poolDiagnostics: Diagnostic[] = [], mustHave: string[] | undefined, only: number[] | undefined;
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
        // null": runSettingsError skips it, and normalising both to absent here lets the destructuring
        // defaults treat null and undefined alike (post-review fix — null used to reach buildPools as a
        // literal `strLimit: null` or throw when an array field's null hit code expecting an array).
        const s = Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v != null));
        const { inv } = await getInventory();
        // No character (NOBODY) builds as a fill with no character does, from the pieces nobody wears, but is saved and
        // reused under its own name like a character's build: `who` is the scanned character, `character` the run's key.
        const who = character === NOBODY ? null : character as string | null;
        // buildPools would happily build pools from every other character's gear and save the run
        // under a name the inventory has never seen.
        if (who && !Object.hasOwn(inv.characters, who)) return send(res, 404, { ok: false, error: `no scans for character ${JSON.stringify(character)}` });
        // runSettingsError checked every field of `s` above. What it leaves out takes the build spec's default
        // (app/build-spec.mts poolFromSpec, as planBuild), as the page and build_suit do: a missing strLimit is the character's STR, else 125.
        const pool = poolFromSpec(specFromRunSettings(s as RunSettings), who ? inv.characters[who] as Character : null);
        const { allowOthersWorn, strLimit, excludeTags, excludeRoots, onlyRoots, allowGargoyle, medOnly, excludeWeapons, ubwsAnyWeapon, excludeSkills, lockedSlots, weaponMustHave } = pool;
        const pins = (pinned || {}) as Record<string, number>;
        const badPin = manualSuitError(inv, pins, "pinned");
        if (badPin) return send(res, 400, { ok: false, error: badPin });
        // a fill keeps the placed pieces in place of the locked slots: they are the only slots that keep their piece
        const keep = fill ? Object.keys(pins) : lockedSlots;
        const poolOpts = { allowOthersWorn: allowOthersWorn && !!character, strength: strLimit, excludeTags, excludeRoots, excludeGargoyle: !allowGargoyle, medOnly, excludeWeapons, ubwsAnyWeapon, excludeSkills, weaponMustHave, lockedSlots: fill ? [] : lockedSlots, ...(fill ? { pinned: pins } : {}) };
        const built = buildPools(inv, who || null, { ...poolOpts, onlyRoots });
        pools = built.pools; current = built.current; blocked = built.blocked;
        // the weapon properties the build requires: a locked weapon without them, or no weapon with them (app/diagnostics.mts)
        mustHave = weaponMustHave; only = onlyRoots;
        if (built.weaponFlags && weaponMustHave) {
          const kept = built.weaponFlags.kept.map((slot) => { const it = inv.items[built.current[slot]!.serial]!; return { slot, name: it.name, missing: missingFlags(it, weaponMustHave) }; });
          poolDiagnostics = weaponFlagDiagnostics(weaponMustHave, kept, built.weaponFlags.none);
        }
        // the slots Only containers leaves with nothing from a container, though the other containers hold a piece for them
        if (onlyRoots?.length) {
          const wide = buildPools(inv, who || null, poolOpts), stored = (list: OptItem[] | undefined): boolean => (list || []).some((o) => inv.items[o.serial]?.root != null);
          poolDiagnostics.push(...onlyRootsDiagnostics(GEAR_SLOTS.filter((sl) => !keep.includes(sl) && stored(wide.pools[sl]) && !stored(built.pools[sl]))));
        }
        skipped = Object.fromEntries(Object.entries(built.skipped).map(([k, v]) => [k, v.length]));
        for (const slot of blocked) delete current[slot];       // a worn piece the filters now rule out must not stay "current"
        if (!fill) for (const slot of lockedSlots) pools[slot] = [];   // a locked slot offers no alternatives — it always keeps current
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
      const tieBreak = (opts as RunOpts).tieBreak as { rarity: RarityPreference } | undefined;
      if (tieBreak) {
        const { inv } = await getInventory(), ladder = getRules().rarity || [];
        const stamp = (it: unknown): unknown => (it && typeof it === "object" ? stampTieCost(it as { serial: number }, inv, tieBreak.rarity, ladder) : it);
        pools = Object.fromEntries(Object.entries(pools).map(([slot, list]) => [slot, (list as unknown[]).map(stamp)]));
        current = Object.fromEntries(Object.entries(current).map(([slot, it]) => [slot, stamp(it)]));
      }
      // profile is scored against in the worker; a string or a number would fail there, not here.
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) return send(res, 400, { ok: false, error: "profile required" });
      const { hardFloors } = profile as { hardFloors?: unknown };
      if (hardFloors != null && (!Array.isArray(hardFloors) || hardFloors.some((k) => !isBoundedString(k, 64)))) return send(res, 400, { ok: false, error: "profile.hardFloors must be an array of property names" });
      const fullOpts = Object.assign({ seed: RUN_DEFAULTS.seed, restarts: RUN_DEFAULTS.restarts }, opts as RunOpts);
      const key = runKey({ pools, current, profile, opts: fullOpts, weaponMustHave: mustHave, onlyRoots: only });
      const runs = runStore.all();
      const hit = fill ? null : reusableRun(runs, key, fullOpts as { timeBudgetMs?: number });
      // §11c: warn (not block) once the candidate pool is large enough that the exact solver can
      // take a while — the page shows this line above the progress panel (Task 3).
      const poolSize = typeof meta.poolSize === "number" ? meta.poolSize : Object.values(pools).reduce((a: number, v) => a + (Array.isArray(v) ? v.length : 0), 0);
      // The by-character form doesn't hand the caller's meta a poolSize/skipped up front (unlike the
      // old form, whose client computes them itself — ui/builder.mts) — fill them in now so a saved
      // run started this way (the jobs service's saveRun() reads job.meta) carries the same figures the response does.
      if (character) { meta.poolSize = poolSize; meta.skipped = skipped; }
      // The requirements no suit in the pool can reach, said before the search starts (app/diagnostics.mts); the result repeats them.
      const diagnostics = [...poolDiagnostics, ...preBuildDiagnostics({ pools: pools as Partial<Record<string, OptItem[]>>, current: current as Partial<Record<string, OptItem | null>>,
        optionalSlots: fullOpts.optionalSlots as string[] | undefined, profile: profile as DiagnosticsProfile })];
      if (hit) return send(res, 200, { ok: true, cached: true, run: hit, poolSize, skipped, current, blocked, diagnostics });
      // warm start: this character's newest saved suit, re-scored under the new settings
      const last = fill ? null : runs.find((r) => r.character === meta.character && r.result && r.result.best);
      // last.result/.best were both truthy-checked by the .find() predicate just above; `.best`'s
      // real shape is an OptAssignment-like {slot -> {serial} | null} map, looser than RunResult's
      // own declared fields (an index-signature read, same trust as everywhere else in this route).
      if (last) fullOpts.warmStart = Object.fromEntries(Object.entries(last.result!.best as Record<string, { serial: number } | null>).map(([slot, it]) => [slot, it ? it.serial : null]));
      // One running build per client, behind a server-wide ceiling (app/services/jobs.mts submit).
      const started = jobService.submit({ pools, current, profile, opts: fullOpts, ...(poolDiagnostics.length ? { diagnostics: poolDiagnostics } : {}) }, key, meta, headerClientId, !fill);
      if (!started) return send(res, 429, { ok: false, error: "too many builds are already running; try again in a moment" });
      const { job, superseded } = started;
      if (poolSize > 50000) job.meta.warning = "over 50,000 candidates; the exact solver may take a while";
      return send(res, 200, { ok: true, id: job.id, warmFrom: last ? last.id : null, superseded, warning: job.meta.warning, poolSize, skipped, current, blocked, diagnostics });
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
      const run = manualRun({ id: randomUUID(), character, createdAt: new Date().toISOString(), settings: settings as Record<string, unknown>, inventoryStamp, suit: pieces, worn, slots: GEAR_SLOTS });
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
      return send(res, 200, { ok: true, evaluation });
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
      return NEXT;
    } },
    { method: "*", path: /^\/api\/optimize\/([\w-]+)\/(events|cancel|status)$/, handle: (req, res, url, jobMatch) => {
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
      return NEXT;
    } },
  ];
}
