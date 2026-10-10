// fc-cap.test.mts — the Faster Casting cap by casting school (issue #213): `fcCapFor` in `app/vault-lib.mts` and where the cap goes.
//
// `[fast]`: the rule's matrix (each school named, the skills' choice at the 30 base mark, the Chivalry caster's drop at Magery or Mysticism 70 and Mysticism 69.9 against 70, Spellweaving kept at 4 when named, No character, a named school over the skills); `effectiveProfile`'s and `evaluateSuit`'s caps follow it, and Manual with No character takes a named school's cap; a build where FC 3-4 is reachable scores it with cap 4 in both solvers and stops at 2 without; and in a saved run: the casting school in `planBuild`'s snapshot only when named, `runSettingsError` and the profiles schema naming the same schools, `settingsDiff`'s line, and the run key following the cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASTING_SCHOOLS, effectiveProfile, fcCapFor, settingsDiff, setRules, type Character } from "./vault-lib.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { evaluateSuit } from "./evaluate.mts";
import { manualProfile } from "./buffs.mts";
import { planBuild, specFromProfile } from "./build-spec.mts";
import { runSettingsError } from "./run-settings.mts";
import { runKey } from "./runs-lib.mts";
import { solveExact, type OptPools } from "./exact-solver.mts";
import { core } from "./solver-fixture.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);
const skills = (s: Record<string, number>): Record<string, unknown> => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { base: v, value: v, cap: 100 }]));
const char = (s: Record<string, number>): Character => ({ name: "Caster", stats: {}, scannedAt: "", position: null, maxes: null, resists: null, skills: skills(s), adapter: null });

test("[fast] fc cap: each school named, the skills' choice, the Chivalry drop at 70, No character", () => {
  const named = Object.fromEntries(CASTING_SCHOOLS.map((s) => [s, fcCapFor(null, s).cap]));
  assert.deepEqual(named, { Magery: 2, Necromancy: 2, Mysticism: 2, Chivalry: 4, Spellweaving: 4, Bushido: 4 });
  assert.deepEqual(fcCapFor(null), { cap: 2, reason: "no character" });
  assert.deepEqual(fcCapFor(null, "Chivalry"), { cap: 4, reason: "Chivalry (chosen)" }, "No character with a named school");
  assert.deepEqual(fcCapFor(skills({ Chivalry: 90 })), { cap: 4, reason: "Chivalry" });
  assert.deepEqual(fcCapFor(skills({ Spellweaving: 30 })), { cap: 4, reason: "Spellweaving" }, "30 base counts");
  assert.deepEqual(fcCapFor(skills({ Spellweaving: 29.9 })), { cap: 2, reason: "no Chivalry, Spellweaving or Bushido" }, "under 30 does not");
  assert.deepEqual(fcCapFor(skills({ Bushido: 120, Chivalry: 90 })), { cap: 4, reason: "Bushido" }, "the highest of the schools names it");
  assert.deepEqual(fcCapFor(skills({ Magery: 100 })), { cap: 2, reason: "no Chivalry, Spellweaving or Bushido" });
  assert.deepEqual(fcCapFor(skills({ Chivalry: 90, Magery: 70 })), { cap: 2, reason: "Magery 70+" }, "Magery 70 drops a Chivalry caster");
  assert.deepEqual(fcCapFor(skills({ Chivalry: 90, Mysticism: 69.9 })), { cap: 4, reason: "Chivalry" }, "Mysticism 69.9 does not");
  assert.deepEqual(fcCapFor(skills({ Chivalry: 90, Mysticism: 70 })), { cap: 2, reason: "Mysticism 70+" }, "Mysticism 70 does");
  assert.deepEqual(fcCapFor(skills({ Spellweaving: 120, Magery: 120 })), { cap: 4, reason: "Spellweaving" }, "from skills, Magery 70 does not drop Spellweaving (ServUO drops only Chivalry)");
  assert.deepEqual(fcCapFor(skills({ Bushido: 100, Mysticism: 100 })), { cap: 4, reason: "Bushido" }, "nor Bushido");
  // a named school wins over the skills; only Chivalry drops at 70
  assert.deepEqual(fcCapFor(skills({ Spellweaving: 120, Magery: 120 }), "Spellweaving"), { cap: 4, reason: "Spellweaving (chosen)" });
  assert.deepEqual(fcCapFor(skills({ Chivalry: 120, Magery: 80 }), "Chivalry"), { cap: 2, reason: "Magery 70+" });
  assert.deepEqual(fcCapFor(skills({ Chivalry: 120 }), "Magery"), { cap: 2, reason: "Magery (chosen)" });
  assert.deepEqual(fcCapFor(skills({ Chivalry: 120 }), "nonsense"), { cap: 4, reason: "Chivalry" }, "an unknown school reads as none");
});

test("[fast] fc cap: effectiveProfile and evaluateSuit take the cap", () => {
  const pal = char({ Chivalry: 100 });
  assert.equal(effectiveProfile({}, pal).caps.fc, 4);
  assert.equal(effectiveProfile({}, null).caps.fc, 2);
  assert.equal(effectiveProfile({ castingSchool: "Bushido" }, null).caps.fc, 4);
  assert.equal(effectiveProfile({ castingSchool: "Magery" }, pal).caps.fc, 2);
  const ev = evaluateSuit({ profile: {}, character: pal, suit: { ring: { props: { fc: 3 } } }, buffs: null });
  assert.equal(ev.caps.fc, 4);
  assert.equal(ev.wasted.fc, undefined, "FC 3 is under a cap of 4");
  assert.equal(evaluateSuit({ profile: {}, character: null, suit: { ring: { props: { fc: 3 } } }, buffs: null }).wasted.fc, 1);
  // Manual with No character plans with a named school's cap, as its totals strip shows it; none named stays at 2
  assert.equal(manualProfile({ castingSchool: "Chivalry" }, null, [], {}, null, [], {}).caps.fc, 4);
  assert.equal(manualProfile({}, null, [], {}, null, [], {}).caps.fc, 2);
  // and its totals strip: the cap a named school sets with no character, the same before and after buffs (no raised-cap mark)
  const strip = evaluateSuit({ profile: { castingSchool: "Chivalry" }, character: null, suit: { ring: { props: { fc: 3 } } }, buffs: null });
  assert.deepEqual([strip.caps.fc, strip.baseCaps.fc, strip.wasted.fc], [4, 4, undefined]);
  assert.equal(manualProfile({ castingSchool: "Chivalry" }, pal, [], {}, "human", [], {}).caps.fc, 4);
});

test("[fast] fc cap: FC 3-4 is reachable and scored with cap 4, in both solvers, and stops at 2 without", async () => {
  const item = (serial: number, slot: string, props: Record<string, number>) => ({ serial, name: `Piece ${serial}`, slot, props });
  const pools: OptPools = { ring: [item(1, "ring", { fc: 2 }), item(2, "ring", { luck: 100 })], bracelet: [item(3, "bracelet", { fc: 2 }), item(4, "bracelet", { luck: 100 })] };
  const slots = ["ring", "bracelet"], opts = { exact: true, timeBudgetMs: 5000, restarts: 0, seed: 1, slots, optionalSlots: slots };
  for (const [who, fc] of [[char({ Chivalry: 100 }), 4], [char({ Chivalry: 100, Magery: 100 }), 2]] as const) {
    const profile = effectiveProfile({ weights: { fc: 100, luck: 1 } }, who);
    const r = await solveExact({ core, pools, current: {}, profile, opts, onProgress: () => {} });
    const ref = core.optimizeSuit(pools, {}, profile, opts);
    const got = (a: typeof r.best): number => (a?.ring?.props.fc || 0) + (a?.bracelet?.props.fc || 0);
    assert.equal(got(r.best), fc, `HiGHS takes FC ${fc}`);
    assert.equal(got(ref.best), fc, `the core takes FC ${fc}`);
    assert.ok(Math.abs(r.score - ref.score) < 1e-6, `${r.score} vs ${ref.score}`);
  }
});

test("[fast] fc cap: a saved run keeps a named school, the checks name the same schools, and the run key follows the cap", () => {
  const pal = char({ Chivalry: 100 });
  const plan = (castingSchool?: string) => planBuild(specFromProfile({ race: "human", ...(castingSchool ? { castingSchool } : {}) }), { character: pal, worn: [], race: "human" });
  assert.equal("castingSchool" in plan().snapshot, false, "from skills: nothing in the snapshot");
  assert.equal(plan("Magery").snapshot.castingSchool, "Magery");
  assert.equal(plan().profile.caps.fc, 4);
  assert.equal(plan("Magery").profile.caps.fc, 2);
  assert.equal("castingSchool" in specFromProfile({}).intent, false, "a spec names the school only when one is chosen");
  assert.equal(runSettingsError({ castingSchool: "Magery" }, "settings"), null);
  assert.match(runSettingsError({ castingSchool: "Cooking" }, "settings") || "", /settings\.castingSchool must be one of Magery, Necromancy/);
  const schema = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as { $defs: { intent: { properties: { castingSchool: { enum: string[] } } } } };
  assert.deepEqual(schema.$defs.intent.properties.castingSchool.enum, [...CASTING_SCHOOLS], "the schema names the same schools");
  assert.deepEqual(settingsDiff({}, { castingSchool: "Chivalry" }), ["casting school Chivalry"]);
  assert.deepEqual(settingsDiff({ castingSchool: "Chivalry" }, {}), ["casting school from skills"]);
  const key = (castingSchool?: string): string => runKey({ pools: {}, current: {}, profile: plan(castingSchool).profile, opts: {} });
  assert.notEqual(key(), key("Magery"), "cap 4 and cap 2 key apart");
  assert.equal(key(), key("Chivalry"), "naming the school the skills pick keys the same");
});
