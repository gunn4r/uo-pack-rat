// builds.mts — the Suit Builder's builds (issue #338): a checked POST /api/optimize request into a started job, or a saved run that answers it.
//
// The route checks the body's shape; this service does the rest, in order: for the by-character form (and Manual's "Fill
// the rest automatically", issue #12) it builds the pool from the cached inventory (`buildPools`, with the pool settings'
// diagnostics), prepares the solve (app/solver/prepare.mts: every input transform and the run key), answers from a saved
// run that cannot be bettered, else picks a warm start and submits the job (app/services/jobs.mts). A hand-built
// {pools, current} request skips the pool step. Its answer is a status and the body the route sends.
//
// map: builder
// owns: `createBuildsService`, `BuildsService`, `BuildRequest`, `poolOptions`, `autoCandidates`, `givenSettings`, `scannedWho`, `manualSuitError`
import { onlyRootsDiagnostics, weaponFlagDiagnostics, type Diagnostic } from "../diagnostics.mts";
import { optionalSlotsFor } from "../mip.mts";
import { reusableRun, poolSnapshot, type RunOpts, type SavedRun } from "../runs-lib.mts";
import type { RunSettings } from "../run-settings.mts";
import { poolFromSpec, specFromRunSettings } from "../build-spec.mts";
import { prepareSolve } from "../solver/prepare.mts";
import { GEAR_SLOTS, NOBODY, buildPools, getRules as rulesNow, missingFlags, type Character, type Inventory, type OptItem, type RarityPreference } from "../vault-lib.mts";
import type { RulesV1 } from "../schema/types.d.mts";
import type { JobsService } from "./jobs.mts";
import type { OptimizeStartApiResponse, Suit } from "../api/optimize.mts";

// A build's settings with their nulls dropped: a `null` in an optional field (as a saved run's settings can carry, e.g.
// re-posted from the runs drawer) means "use the default", exactly like an absent field.
export const givenSettings = (settings: Record<string, unknown> | undefined): Record<string, unknown> => Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v != null));
// The scanned character a build's pool is for: No character (NOBODY) builds from the pieces nobody wears, as a fill with no character does.
export const scannedWho = (character: string | null): string | null => (character === NOBODY ? null : character);
// buildPools' options from a build's settings (`s`, givenSettings) for `character` (NOBODY: the pieces nobody wears;
// null: a fill with no character), with the pool settings they come from; `pins`: a fill's placed pieces. A build uses
// them, and a saved run's gear changes rebuild its pool with them (issue #291).
export function poolOptions(inv: Inventory, character: string | null, s: Record<string, unknown>, pins?: Record<string, number>) {
  const who = scannedWho(character);
  // runSettingsError checked every field of `s`. What it leaves out takes the build spec's default
  // (app/build-spec.mts poolFromSpec, as planBuild), as the page and build_suit do: a missing strLimit is the character's STR, else 125.
  const pool = poolFromSpec(specFromRunSettings(s as RunSettings), who ? inv.characters[who] as Character : null);
  const { allowOthersWorn, strLimit, excludeTags, excludeRoots, allowGargoyle, medOnly, excludeWeapons, ubwsAnyWeapon, excludeSkills, lockedSlots, weaponMustHave } = pool;
  return { pool, poolOpts: { allowOthersWorn: allowOthersWorn && !!character, strength: strLimit, excludeTags, excludeRoots, excludeGargoyle: !allowGargoyle, medOnly, excludeWeapons, ubwsAnyWeapon, excludeSkills, weaponMustHave, lockedSlots: pins ? [] : lockedSlots, ...(pins ? { pinned: pins } : {}) } };
}
// The pieces a by-character build with these settings would pick from (#487, the Manual picker's "Only what Auto would
// use"): in every slot the piece the character wears there, which a build keeps as a candidate whatever the filters say
// ("keep what you wear", docs/solver.md) unless the settings block it, and in an unlocked slot the pool's candidates too;
// a locked slot offers only its worn piece.
export function autoCandidates(inv: Inventory, character: string | null, s: Record<string, unknown>): Set<number> {
  const { pool: { onlyRoots, lockedSlots }, poolOpts } = poolOptions(inv, character, s);
  const { pools, current, blocked } = buildPools(inv, scannedWho(character), { ...poolOpts, onlyRoots });
  const keep = new Set<number>();
  for (const slot of GEAR_SLOTS) {
    if (current[slot] && !blocked.includes(slot)) keep.add(current[slot]!.serial);
    if (!lockedSlots.includes(slot)) for (const o of pools[slot] || []) keep.add(o.serial);
  }
  return keep;
}
// Manual's suit against the inventory (a fill's `pinned`, a manual run's `suit`): each serial a gear piece of its slot in
// the scans, and no two-handed weapon beside a one-hander.
export function manualSuitError(inv: Inventory, suit: Record<string, number>, path: string): string | null {
  for (const [slot, serial] of Object.entries(suit)) {
    const it = inv.items[serial];
    if (!it?.gear || it.slot !== slot) return `${path}.${slot}: 0x${serial.toString(16)} is not a gear piece for that slot in your scans`;
  }
  if (suit.twoHanded != null && suit.oneHanded != null && inv.items[suit.twoHanded]!.twoHanded) return `${path}: a two-handed weapon leaves the one-hand slot empty`;
  return null;
}

// A POST /api/optimize body as the route checked it: opts, meta (pickMeta'd), settings, the character, a fill's pins and the profile's fields hold their rules.
export interface BuildRequest {
  pools: Record<string, unknown>;
  current: Record<string, unknown>;
  profile: object;
  opts: RunOpts;
  meta: Record<string, unknown>;
  character: string | null;
  settings: Record<string, unknown>;
  pinned: Record<string, number> | null;   // Manual's suit, {slot: serial}: a fill, never saved as a run nor answered by one
}
export type BuildAnswer = { status: number; body: Record<string, unknown> };
export interface BuildsService { start(req: BuildRequest, clientId: string | string[] | null): Promise<BuildAnswer> }

export function createBuildsService({ getInventory, getRules = rulesNow, runStore, jobService }: {
  getInventory: () => Promise<{ inv: Inventory }>;
  getRules?: () => Pick<RulesV1, "rarity">;   // the shard rules the rarity ladder is read from (vault-lib.mts getRules)
  runStore: { all(): SavedRun[] };
  jobService: Pick<JobsService, "submit">;
}): BuildsService {
  const refuse = (status: number, error: string): BuildAnswer => ({ status, body: { ok: false, error } });
  async function start(req: BuildRequest, clientId: string | string[] | null): Promise<BuildAnswer> {
    let { pools, current, opts, meta } = req;
    const { profile, character, settings, pinned } = req;
    let skipped: Record<string, number> = {}, blocked: string[] = [], poolDiagnostics: Diagnostic[] = [], mustHave: string[] | undefined, only: number[] | undefined;
    const fill = pinned != null;
    if (character || fill) {
      const s = givenSettings(settings);
      const { inv } = await getInventory();
      // No character (NOBODY) builds as a fill with no character does, from the pieces nobody wears, but is saved and
      // reused under its own name like a character's build: `who` is the scanned character, `character` the run's key.
      const who = scannedWho(character);
      // buildPools would happily build pools from every other character's gear and save the run
      // under a name the inventory has never seen.
      if (who && !Object.hasOwn(inv.characters, who)) return refuse(404, `no scans for character ${JSON.stringify(character)}`);
      const pins = pinned || {};
      const { pool: { onlyRoots, lockedSlots, weaponMustHave, strLimit }, poolOpts } = poolOptions(inv, character, s, fill ? pins : undefined);
      const badPin = manualSuitError(inv, pins, "pinned");
      if (badPin) return refuse(400, badPin);
      // a fill keeps the placed pieces in place of the locked slots: they are the only slots that keep their piece
      const keep = fill ? Object.keys(pins) : lockedSlots;
      const built = buildPools(inv, who || null, { ...poolOpts, onlyRoots });
      // the pool a saved run keeps, to say later which pieces came and went (issue #291)
      if (!fill) meta.pool = poolSnapshot(inv, built.pools, built.current, strLimit);
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
      opts = { ...opts, optionalSlots: optionalSlotsFor(built.current, keep) };   // `current`, its blocked pieces deleted above
      // The saved run keeps the page's whole settings snapshot (floors, weights, race, search knobs:
      // the runs drawer labels, compares and re-applies runs from it), with the pool settings it
      // actually ran on written over it.
      meta = { ...meta, character, settings: { ...((meta.settings as Record<string, unknown> | undefined) || {}), ...s } };
    }
    // every transform of the solve's input and the run key, in their one order (app/solver/prepare.mts)
    const rarity = (opts.tieBreak as { rarity?: RarityPreference } | undefined)?.rarity;
    const { input, key, scaleDiagnostics, preDiagnostics } = prepareSolve({ pools, current, profile, opts, weaponMustHave: mustHave, onlyRoots: only,
      rarity: rarity ? { inv: (await getInventory()).inv, ladder: getRules().rarity || [] } : null });
    const fullOpts = input.opts;
    ({ pools, current } = input);
    poolDiagnostics = [...poolDiagnostics, ...scaleDiagnostics];
    const runs = runStore.all();
    const hit = fill ? null : reusableRun(runs, key, fullOpts as { timeBudgetMs?: number });
    // Warn (not block) once the candidate pool is large enough that the exact solver can
    // take a while: the page shows this line above the progress panel.
    const poolSize = typeof meta.poolSize === "number" ? meta.poolSize : Object.values(pools).reduce((a: number, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    // The by-character form doesn't hand the caller's meta a poolSize/skipped up front (unlike the
    // old form, whose client computes them itself — ui/builder.mts) — fill them in now so a saved
    // run started this way (the jobs service's saveRun() reads job.meta) carries the same figures the response does.
    if (character) { meta.poolSize = poolSize; meta.skipped = skipped; }
    // The requirements no suit in the pool can reach, said before the search starts (app/diagnostics.mts); the result repeats them.
    const diagnostics = [...poolDiagnostics, ...preDiagnostics];
    // `current` is a suit of OptItems on every path: the server built it (by character, a fill), or the route checked
    // each piece of a hand-built one (app/http/routes/optimize.mts optItemError).
    if (hit) return { status: 200, body: { ok: true, cached: true, run: hit, poolSize, skipped, current: current as Suit, blocked, diagnostics } satisfies OptimizeStartApiResponse };
    // warm start: this character's newest saved suit, re-scored under the new settings
    const last = fill ? null : runs.find((r) => r.character === meta.character && r.result && r.result.best);
    // last.result/.best were both truthy-checked by the .find() predicate just above; `.best`'s
    // real shape is an OptAssignment-like {slot -> {serial} | null} map, looser than RunResult's
    // own declared fields (an index-signature read, same trust as everywhere else in this service).
    if (last) fullOpts.warmStart = Object.fromEntries(Object.entries(last.result!.best as Record<string, { serial: number } | null>).map(([slot, it]) => [slot, it ? it.serial : null]));
    // One running build per client, behind a server-wide ceiling (app/services/jobs.mts submit).
    const started = jobService.submit({ ...input, ...(poolDiagnostics.length ? { diagnostics: poolDiagnostics } : {}) }, key, meta, clientId, !fill);
    if (!started) return refuse(429, "too many builds are already running; try again in a moment");
    const { job, superseded } = started;
    if (poolSize > 50000) job.meta.warning = "over 50,000 candidates; the exact solver may take a while";
    // the answer passes on a warning only as text: the caller's own meta can carry anything under that name
    const warning = job.meta.warning;
    return { status: 200, body: { ok: true, id: job.id, warmFrom: last ? last.id : null, superseded, ...(typeof warning === "string" ? { warning } : {}), poolSize, skipped, current: current as Suit, blocked, diagnostics } satisfies OptimizeStartApiResponse };
  }
  return { start };
}
