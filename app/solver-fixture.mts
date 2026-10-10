// solver-fixture.mts — what the solver-equivalence test files share: the TazUO adapter fixture folded
// and pooled, the shipped default templates, cell() to build a solver input from one of them, and
// runBoth() to run HiGHS and the core on it and check they agree. Split out so the slow cases can live
// in files of their own, which the runner runs in parallel.
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { buildPools, setRules, foldSnapshots, GEAR_SLOTS, type Template, type BuildPoolsResult } from "./vault-lib.mts";
import { templateSettings, type TemplateMap } from "./build-spec.mts";
import { upgradeScan } from "./scan-schema.mts";
import { buffSkillValues, plannedProfile } from "./buffs.mts";
import type { ScanV2 } from "./schema/types.d.mts";
import { corePath } from "./config.mts";
import { solveExact, type OptPools, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import { DEFAULT_SLOTS, withReachableResistSteps } from "./mip.mts";
import type * as Core from "../scripts/optimizer-core.mts";

// solveExact's own `opts` field type (the core's real OptOptions, derived rather than restated —
// see app/exact-solver.mts's header note and scripts/optimizer-core.test.mts for the pattern).
export type OptOptions = Parameters<typeof solveExact>[0]["opts"];

const HERE = dirname(fileURLToPath(import.meta.url));
// A direct call to a rules-aware function (buildPools, effectiveProfile) with no server started
// needs setRules() first, same as gear-vault.test.mts / server.test.mts.
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")));

export const core = (await import(pathToFileURL(corePath()).href)) as typeof Core;

// The TazUO fixture (Task 1's adapter fixture): 319 real items, character "Fixture". Already
// schemaVersion 2 — upgradeScan just stamps the shard.
const fixtureRaw = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
export const fixture = upgradeScan(fixtureRaw, { shard: "uoalive" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
const inv = foldSnapshots([fixture]);
const { pools: fixturePools, current: fixtureCurrent } = buildPools(inv, "Fixture", { excludeGargoyle: true });
// The shipped built-in templates (app/data/templates/uoalive.json), as the panel's settings.
const builtins = (JSON.parse(readFileSync(join(HERE, "data", "templates", "uoalive.json"), "utf8")) as { templates: TemplateMap }).templates;
export const defaultProfiles: { templates: Record<string, Template> } = { templates: Object.fromEntries(Object.entries(builtins).map(([id, t]) => [id, templateSettings(t)])) };
// The four generic starters only: the build templates (#212) have their own test (solver-builtins.test.mts), so the
// equivalence and buff-plan tests and their hashes stay on these.
export const templateNames = ["melee", "caster", "archer", "tank"];

// cell(profileName, {soft, overrides}) — the fixture's pools/current, plus a profile built from one
// of the shipped default templates: `overrides` land on the template (before effectiveProfile), so
// e.g. `{ overrides: { floors: { ...template.floors, luck: 5000 } } }` adds an extra hard floor. `buffs` are planned
// on (app/buffs.mts plannedProfile) with the fixture character's skills, the rest at their defaults.
//
// fixturePools/fixtureCurrent are vault-lib.mts's PooledOptItem-based shapes (buildPools's own return
// type, honestly typed with a required, non-null `slot` — see vault-lib.mts's own comment on
// PooledOptItem). The cast below is still needed, but for a narrower reason now: OptPools/OptAssignment
// (derived via Parameters<> on Core.optimizeSuit — see app/exact-solver.mts's header note) are plain
// `Record`s, while buildPools's own return type is a `Partial<Record<...>>` (a slot with no candidates
// is simply absent, not present with an empty array) — that optional-vs-required container shape is
// what the cast crosses now, not an item-level mismatch. The guard below asserts the item level stays
// aligned on its own.
export function cell(profileName: string, { soft = [], overrides = {}, buffs = [] }: { soft?: string[] | undefined; overrides?: Partial<Template> | undefined; buffs?: string[] | undefined } = {}): { pools: OptPools; current: OptAssignment; profile: OptProfile } {
  const template = defaultProfiles.templates![profileName]!;
  const p = { ...template, softFloors: [...soft], ...overrides }, c = inv.characters.Fixture!;
  const planned = plannedProfile(p, c, buffs.length ? { on: buffs, skills: buffSkillValues(c.skills || {}, {}).values, stats: null, who: {}, worn: {} } : null);
  // the Resisting Spells steps the pool reaches, as the server keeps them (app/http/routes/optimize.mts)
  const profile = withReachableResistSteps(planned, fixturePools, fixtureCurrent);
  return { pools: fixturePools as unknown as OptPools, current: fixtureCurrent as unknown as OptAssignment, profile };
}

// Compile-time-only guard (review follow-up): scripts/optimizer-core.mts declares its own OptItem
// (unexported, no import from vault-lib.mts — the core is a paste-able file with no imports at all,
// see its own header comment) and vault-lib.mts declares its own, independently. A reviewer proved
// with `tsc` they had ALREADY drifted once (vault-lib's plain OptItem had `slot: string | null`; the
// core's has always required a non-null `slot`) with nothing to catch it but a human reading a `tsc`
// diff by hand — harmless only because every caller of toOptItem happened to filter out slotless
// items before building pools. buildPools's PooledOptItem now types that filtering honestly; this
// line asserts, at compile time only (no runtime check, no value ever read — see `void` below), that
// a pooled item's `slot` is assignable to the core's own item's `slot`. If the two drift again,
// `npm run typecheck` fails exactly here instead of staying silent. (The item's OTHER fields aren't
// checked here on purpose: `twoHanded`'s `true | undefined` vs the core's plain `boolean` is a
// separate, already-accepted structural difference — see app/exact-solver.mts's header note — not a
// drift this guard is for.)
type CorePooledItem = NonNullable<OptPools[string]>[number];
type VaultPooledItem = NonNullable<BuildPoolsResult["pools"][string]>[number];
const _pooledSlotAssignable: CorePooledItem["slot"] = null as unknown as VaultPooledItem["slot"];
void _pooledSlotAssignable;

// A fuzz instance's slots, in GEAR_SLOTS order: two to `max` of the nineteen gear slots (issue #202), so items land in
// every slot over a run while brute force stays small. The hand pair comes together in about half the instances, so
// the hand rule is exercised.
export function fuzzSlots(rnd: () => number, max: number): string[] {
  const pair = rnd() < 0.5, picked = pair ? ["oneHanded", "twoHanded"] : [];
  const rest = GEAR_SLOTS.filter((s) => !picked.includes(s)), want = 2 + Math.floor(rnd() * (max - 1));
  while (picked.length < want) picked.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]!);
  return GEAR_SLOTS.filter((s) => picked.includes(s));
}

export const sig = (assignment: OptAssignment | null | undefined): string => DEFAULT_SLOTS.map((s) => (assignment && assignment[s] ? assignment[s]!.serial : null)).join(",");

// Runs both solvers on the same inputs and checks the shared invariants: HiGHS reports itself as
// the solver, and its returned score is the core's own re-score of its own suit (never a value
// computed only inside the MIP). When both sides prove, their scores must agree to the decimal; on
// the real 319-item fixture a template is not guaranteed to prove in budget, so an unproven side
// only has to be no worse than the core (never a regression) — noted via t.diagnostic rather than
// failed, since that outcome is a timing fact about the machine, not a bug.
export async function runBoth(t: TestContext, { pools, current, profile }: { pools: OptPools; current: OptAssignment; profile: OptProfile }, opts: OptOptions) {
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {} });
  const ref = core.optimizeSuit(pools, current, profile, opts);
  assert.equal(r.solver, "highs");
  assert.ok(Math.abs(core.scoreSet(r.best, profile) - r.score) < 1e-6, "returned score must be the core's own re-score of its own suit");
  if (r.proven && ref.proven) {
    assert.ok(Math.abs(r.score - ref.score) < 1e-3, `HiGHS ${r.score} != core ${ref.score}`);
  } else {
    t.diagnostic(`not both proven (highs proven=${r.proven}, core proven=${ref.proven}) — checking no-regression instead of equality`);
    assert.ok(r.score >= ref.score - 1e-6, `HiGHS ${r.score} worse than the core's ${ref.score}`);
  }
  return { r, ref };
}

export const BASE_OPTS: OptOptions = { exact: true, timeBudgetMs: 20000, restarts: 50, seed: 2026 };
