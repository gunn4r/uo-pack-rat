// goals.test.mts — the Suit Builder's goals (issue #292): ranked goals compiled to the weights the solvers score with, and a build from goals being the build from those weights.
//
// `[fast]`: `app/vault-lib.mts`'s `compileGoals`: the rank importances (100, 80, 65, 50, 40, 30, 25, 20, 15, then 15 for every later rank), linked properties sharing their rank's, the spare-points group at 5 less any member that is a goal, SSI by swing step on with a Swing speed goal in either swing mode, an empty list, the tag penalty kept, and the same goals always compiling to the same weights; `goalsError` (unknown property names refused, named); a goals change counting as one settings change (`settingsDiff`); `app/build-spec.mts`'s `planBuild` capping SSI at a swing-every-N-s goal's step for the weapon worn now (none for the fastest swing, nor for weights set by hand) and `app/swing.mts`'s step table keeping no point past that cap; every built-in template's weights and swing-step switch equal to what its goals compile to; the step table's credit held at a swing-time goal's cap however the faster swing is reached (a review repro); a run's saved settings planning the same SSI cap and swing as its build; a spec read back recompiling the weights its goals set; and two seeded fuzzes: over small random pools with no character, a build from random goals equals the build from their compiled weights and the brute-force best of the goals' own scoring, and the trade finder (`app/ui/builder-model.mts`'s `goalTrades`) names a trade exactly when a higher goal went down while a lower one went up; and with the demo characters' own swings, random goals ranking Swing speed in both modes, planned as the page plans them, score an oracle that prices each suit's own swing from the formula held at the goal's step, while two broken builds (no credit cap, ranks reversed) each miss it at least once. Issue #302: a run built from goals keeps its Swing speed goal's weapon (name and base speed) and stamina, passing the run-settings check (bad shapes refused), a reopened run plans its cap from them after the weapon is taken off while a run saved before them falls back to the weapon worn now, the goal's cap is stored with the swing (`goalSsi`), and the step credit holds at a goal of exactly SSI 60 as at 59, with 61 past the cap; the settings diff names goals by their goal names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileGoals, foldSnapshots, goalsError, importanceOf, settingsDiff, toOptItem, typicalRange, IMPORTANCE_K, LEFTOVER_GROUPS, GOAL_LEFTOVERS, type Goals, type Item } from "./vault-lib.mts";
import { upgradeScan } from "./scan-schema.mts";
import { buildSpec, goalSsiCap, planBuild, profileFromSpec, specFromRunSettings, type BuildSpecSource, type TemplateMap } from "./build-spec.mts";
import { heldWeapon, stepsFor, stepTable, swingSteps, swingTicks } from "./swing.mts";
import { propertyReach } from "./mip.mts";
import { runSettingsError } from "./run-settings.mts";
import { core } from "./solver-fixture.mts";   // also loads the uoalive rules
import { goalTrades } from "./ui/builder-model.mts";
import type { OptPools } from "./exact-solver.mts";

const importances = (g: Goals, kept: Record<string, number> = {}): Record<string, number> =>
  Object.fromEntries(Object.entries(compileGoals(g, kept).weights).map(([k, w]) => [k, k === "tagPenalty" ? w : Math.round(importanceOf(k, w) * 1e6) / 1e6]));

test("[fast] goals: each rank counts 100, 80, 65, 50, 40, 30, 25, 20, 15, then 15; linked properties share their rank's", () => {
  assert.deepEqual(importances({ ranks: [["ssi"], ["hci", "dci"], ["di"]], leftover: "none" }), { ssi: 100, hci: 80, dci: 80, di: 65 });
  const twelve = ["ssi", "hci", "dci", "di", "lmc", "lrc", "fc", "fcr", "sdi", "hpi", "luck", "manaRegen"];
  assert.deepEqual(Object.values(importances({ ranks: twelve.map((k) => [k]), leftover: "none" })), [100, 80, 65, 50, 40, 30, 25, 20, 15, 15, 15, 15]);
  // a linked rank moves every rank below it up: the third property counts 80, not 65
  assert.deepEqual(importances({ ranks: [["fc", "fcr"], ["lmc"], ["lrc"]], leftover: "none" }), { fc: 100, fcr: 100, lmc: 80, lrc: 65 });
  // a weight is per point, importance ÷ (typical × K), to 12 significant digits: DI's 100 over its typical 100 is 4.5, not 4.500000000000001
  assert.equal(compileGoals({ ranks: [["di"]], leftover: "none" }).weights.di, 4.5);
  assert.equal(compileGoals({ ranks: [["ssi"], ["hci"], ["di"]], leftover: "none" }).weights.di, 2.925);
});

test("[fast] goals: spare points go to their group at 5, except to a member that is a goal; Nothing adds none", () => {
  for (const leftover of GOAL_LEFTOVERS) {
    const w = importances({ ranks: [["ssi"]], leftover });
    assert.deepEqual(Object.keys(w), ["ssi", ...LEFTOVER_GROUPS[leftover]], leftover);
    for (const k of LEFTOVER_GROUPS[leftover]) assert.equal(w[k], 5, `${leftover} ${k}`);
  }
  // LMC is a goal: it keeps its rank's 80, and the rest of Caster stats get 5
  assert.deepEqual(importances({ ranks: [["fc"], ["lmc"]], leftover: "caster" }), { fc: 100, lmc: 80, intBonus: 5, manaInc: 5, manaRegen: 5, lrc: 5 });
  assert.deepEqual(importances({ ranks: [["luck"]], leftover: "luck" }), { luck: 100 });
});

test("[fast] goals: a Swing speed goal turns SSI by step on in either mode; none, an empty list and the tag penalty", () => {
  for (const swing of [{ mode: "fastest" as const }, { mode: "every" as const, seconds: 1.5 }, undefined]) {
    const c = compileGoals({ ranks: [["hci"], ["ssi"]], leftover: "none", ...(swing ? { swing } : {}) });
    assert.equal(c.swingSteps, true, JSON.stringify(swing));
    assert.deepEqual(Object.keys(c.weights), ["hci", "ssi"]);
  }
  assert.equal(compileGoals({ ranks: [["hci"]], leftover: "melee", swing: { mode: "every", seconds: 1.5 } }).swingSteps, false, "no SSI goal: per point");
  assert.deepEqual(compileGoals({ ranks: [], leftover: "none" }), { weights: {}, swingSteps: false }, "an empty list sets no weight");
  // the tag penalty, a weight the builder never offers, is kept from the profile's weights; every other weight is the goals'
  assert.deepEqual(compileGoals({ ranks: [], leftover: "luck" }, { tagPenalty: -25, dci: 10, luck: 3 }).weights, { tagPenalty: -25, luck: 0.045 });
});

test("[fast] goals: the same goals always compile to the same weights", () => {
  const g: Goals = { ranks: [["ssi"], ["hci", "dci"], ["di"], ["sk:magery"]], swing: { mode: "every", seconds: 1.75 }, leftover: "melee" };
  const first = compileGoals(g, { tagPenalty: -25 });
  for (let i = 0; i < 5; i++) assert.deepEqual(compileGoals(structuredClone(g), { tagPenalty: -25, hci: i }), first);
  assert.deepEqual(JSON.stringify(compileGoals(g, { tagPenalty: -25 }).weights), JSON.stringify(first.weights), "in the same key order");
});

test("[fast] goals: the check names what is wrong", () => {
  const ok: Goals = { ranks: [["ssi"], ["hci", "dci"]], swing: { mode: "every", seconds: 1.5 }, leftover: "luck", ownWeights: true };
  assert.equal(goalsError(ok, "goals"), null);
  assert.equal(goalsError({ ranks: [], leftover: "none" }, "goals"), null, "no goals at all is fine");
  assert.equal(goalsError({ ranks: [["stamPool"], ["sk:magery", "physResist"]], leftover: "none" }, "goals"), null, "a pool, a skill bonus and a resist");
  const bad: Array<[unknown, RegExp]> = [
    [[], /goals must be an object/], [{ ranks: [["ssi"]], leftover: "luck", strategy: "strict" }, /goals\.strategy is not a goals setting/],
    [{ ranks: [[]], leftover: "luck" }, /ranks must be a list of at most 40 ranks, each a list of 1 to 10 property names/], [{ ranks: [Array.from({ length: 11 }, (_, i) => `k${i}`)], leftover: "luck" }, /each a list of 1 to 10/],
    [{ ranks: [["tagPenalty"]], leftover: "luck" }, /names "tagPenalty", which is not a property the Suit Builder offers/], [{ ranks: [["__proto__"]], leftover: "luck" }, /names "__proto__"/],
    [{ ranks: [["SSI"], ["hitChance"]], leftover: "luck" }, /names "SSI", which is not a property/], [{ ranks: [["sk:basket weaving"]], leftover: "luck" }, /names "sk:basket weaving"/],
    [{ ranks: [["ssi"], ["ssi"]], leftover: "luck" }, /names a property twice/],
    [{ ranks: [["ssi"]], leftover: "gold" }, /leftover must be one of luck, melee, caster, none/], [{ ranks: [["ssi"]], leftover: "luck", ownWeights: 1 }, /ownWeights must be a boolean/],
    [{ ranks: [["ssi"]], leftover: "luck", swing: { mode: "slow" } }, /swing must be/], [{ ranks: [["ssi"]], leftover: "luck", swing: { mode: "every" } }, /seconds is needed/],
    [{ ranks: [["ssi"]], leftover: "luck", swing: { mode: "every", seconds: 1.3 } }, /quarter seconds/], [{ ranks: [["ssi"]], leftover: "luck", swing: { mode: "every", seconds: 0.5 } }, /from 1\.25 to 10/],
  ];
  for (const [v, re] of bad) assert.match(String(goalsError(v, "goals")), re, JSON.stringify(v));
});

test("[fast] goals: a goals change is one settings change, and the weights it sets are not compared", () => {
  const melee: Goals = { ranks: [["ssi"], ["hci", "dci"], ["di"]], swing: { mode: "fastest" }, leftover: "luck" };
  const run = (g: Goals) => ({ goals: g, ...compileGoals(g, { tagPenalty: -25 }) });
  const moved: Goals = { ...melee, ranks: [["hci", "dci"], ["ssi"], ["di"]] };
  assert.deepEqual(settingsDiff(run(melee), run(moved)), ["goals: Hit chance = Defense chance › Swing speed › Damage, spare points to luck"]);
  assert.deepEqual(settingsDiff(run(melee), run({ ...melee, swing: { mode: "every", seconds: 1.5 } })), ["goals: Swing speed every 1.5 s › Hit chance = Defense chance › Damage, spare points to luck"]);
  assert.deepEqual(settingsDiff(run(melee), run({ ...melee, leftover: "none" })), ["goals: Swing speed › Hit chance = Defense chance › Damage, spare points to nothing"]);
  assert.deepEqual(settingsDiff(run(melee), run(structuredClone(melee))), [], "the same goals");
  // with the weights set by hand on either side, the weights are what differs, as before goals
  const own = { ...run(melee), goals: { ...melee, ownWeights: true }, weights: { ...run(melee).weights, luck: 1 } };
  assert.deepEqual(settingsDiff(run(melee), own), ["Luck weight 5 → 111"]);
});

// The demo characters as scanned: Kestrel holds a 3 s War Axe at 100 stamina, so her steps are 2.0 s at SSI 1, 1.75 s at 13, 1.5 s at 29 and 1.25 s at 51.
const demo = (n: string) => upgradeScan(JSON.parse(readFileSync(new URL(`./fixtures/demo-${n}.json`, import.meta.url), "utf8")), { shard: "test" });
const inv = foldSnapshots([demo("Kestrel"), demo("Dorran")] as Parameters<typeof foldSnapshots>[0]);
const wornBy = (n: string): Item[] => Object.values(inv.items).filter((it) => it.equippedBy === n);

test("[fast] goals: a swing every N s caps SSI at that step for the weapon worn now, and the step table stops there", () => {
  const plan = (goals: Goals) => {
    const c = compileGoals(goals);
    return planBuild(buildSpec({ intent: { weights: c.weights, swingSteps: c.swingSteps, goals } }), { character: inv.characters.Kestrel!, worn: wornBy("Kestrel") }).profile;
  };
  const ssi: Goals = { ranks: [["ssi"], ["hci"]], leftover: "none" };
  assert.equal(plan({ ...ssi, swing: { mode: "every", seconds: 1.5 } }).caps.ssi, 29);
  assert.equal(plan({ ...ssi, swing: { mode: "every", seconds: 2 } }).caps.ssi, 1);
  assert.equal(plan({ ...ssi, swing: { mode: "fastest" } }).caps.ssi, 60, "the fastest swing: the shard's cap");
  assert.equal(plan({ ...ssi, swing: { mode: "every", seconds: 1.5 }, ownWeights: true }).caps.ssi, 60, "weights set by hand: no goal caps anything");
  assert.equal(plan({ ranks: [["hci"]], leftover: "none", swing: { mode: "every", seconds: 1.5 } }).caps.ssi, 60, "no Swing speed goal");
  assert.equal(plan({ ...ssi, swing: { mode: "every", seconds: 1.5 } }).swing?.steps, true);
  // the step table both solvers score with keeps no point past the cap
  const worn = wornBy("Kestrel").filter((it) => it.slot).map(toOptItem), axe = heldWeapon(Object.fromEntries(worn.map((it) => [it.slot!, it])))!;
  const table = (goals: Goals) => stepsFor(plan(goals), { [axe.slot!]: [axe] }, { [axe.slot!]: axe }, { min: 0, max: 30 }).ssiSteps!.map((p) => p.ssi);
  assert.ok(table({ ...ssi, swing: { mode: "every", seconds: 1.5 } }).every((s) => s <= 29));
  assert.ok(table({ ...ssi, swing: { mode: "fastest" } }).some((s) => s > 29), "the fastest swing keeps the faster steps");
});

// Review of #301: a delay faster than the goal's, reached through more stamina, must not credit more than the goal either.
// A 2.5 s weapon at a reference stamina of 95 needs SSI 1 for 1.5 s; one stamina band up (+40 gear stamina) reaches 1.25 s.
test("[fast] goals: a swing-time goal's SSI cap holds the step credit too, however the faster swing is reached", () => {
  const pools = { oneHanded: [{ serial: 1, name: "Blade", slot: "oneHanded", props: {}, speed: 2.5 }] }, current = { oneHanded: pools.oneHanded[0]! };
  const profile = (cap: number) => ({ swing: { stamBase: 80, refStamina: 95, steps: true, ...(cap < 60 ? { goalSsi: cap } : {}) }, weights: { ssi: 1 }, caps: { ssi: cap } });
  const capped = stepsFor(profile(1), pools, current, { min: 0, max: 40 }).ssiSteps!;
  assert.ok(capped.length > 0 && capped.every((p) => p.credit <= 1 && p.ssi <= 1), JSON.stringify(capped));
  // with no goal (the formula's 60) the band above keeps its full price, as before goals
  assert.ok(stepsFor(profile(60), pools, current, { min: 0, max: 40 }).ssiSteps!.some((p) => p.credit > 1));
});

test("[fast] goals: a run's saved settings plan the same SSI cap and swing as the build did", () => {
  const goals: Goals = { ranks: [["ssi"], ["hci"]], swing: { mode: "every", seconds: 1.5 }, leftover: "luck" }, c = compileGoals(goals);
  const ctx = { character: inv.characters.Kestrel!, worn: wornBy("Kestrel") };
  const live = planBuild(buildSpec({ intent: { weights: c.weights, swingSteps: c.swingSteps, goals } }), ctx);
  const reopened = planBuild(specFromRunSettings(live.snapshot), { ...ctx, race: live.snapshot.race, goalSwing: live.snapshot.goalSwing });
  assert.equal(reopened.profile.caps.ssi, 29);
  assert.deepEqual([reopened.profile.caps.ssi, reopened.profile.swing], [live.profile.caps.ssi, live.profile.swing]);
});

// Issue #302: a run built from goals keeps the swing goal's weapon (name and base speed) and the stamina, and a reopened run
// plans its cap from them, not from the weapon worn now; a run saved before them falls back to the weapon worn now.
test("[fast] goals: a run keeps its swing goal's weapon and stamina, and a reopened run plans from them", () => {
  const goals: Goals = { ranks: [["ssi"], ["hci"]], swing: { mode: "every", seconds: 1.5 }, leftover: "luck" }, c = compileGoals(goals);
  const spec = buildSpec({ intent: { weights: c.weights, swingSteps: c.swingSteps, goals } }), worn = wornBy("Kestrel"), character = inv.characters.Kestrel!;
  const axe = heldWeapon(Object.fromEntries(worn.filter((it) => it.slot).map((it) => [it.slot!, toOptItem(it)])))!;
  const live = planBuild(spec, { character, worn });
  assert.deepEqual(live.snapshot.goalSwing, { weapon: axe.name, speed: axe.speed, stamina: live.profile.swing!.refStamina });
  assert.equal(runSettingsError(live.snapshot, "settings"), null, "a run's settings with the goal's weapon pass the run-settings check");
  assert.equal(live.profile.swing!.goalSsi, 29, "the goal's cap is stored with the swing");
  // the weapon taken off since: the reopened run still plans the goal for the weapon it was built with
  const unarmed = worn.filter((it) => !it.slot || toOptItem(it).serial !== axe.serial), st = live.snapshot;
  const reopened = planBuild(specFromRunSettings(st), { character, worn: unarmed, race: st.race, goalSwing: st.goalSwing });
  assert.deepEqual([reopened.profile.caps.ssi, reopened.profile.swing?.goalSsi, reopened.snapshot.goalSwing], [29, 29, st.goalSwing]);
  const { goalSwing: _old, ...before } = st;
  const old = planBuild(specFromRunSettings(before), { character, worn: unarmed, race: st.race });
  assert.deepEqual([old.profile.caps.ssi, old.profile.swing?.goalSsi, old.snapshot.goalSwing], [60, undefined, undefined], "a run saved before #302: the weapon worn now (none)");
  // the fastest swing keeps the weapon too, with no cap; weights set by hand and goals without Swing speed keep none
  assert.equal(planBuild(buildSpec({ intent: { ...compileGoals({ ...goals, swing: { mode: "fastest" } }), goals: { ...goals, swing: { mode: "fastest" } } } }), { character, worn }).snapshot.goalSwing?.speed, axe.speed);
  assert.equal(planBuild(buildSpec({ intent: { ...c, goals: { ...goals, ownWeights: true } } }), { character, worn }).snapshot.goalSwing, undefined);
  assert.equal(planBuild(buildSpec({ intent: { ...compileGoals({ ranks: [["hci"]], leftover: "luck" }), goals: { ranks: [["hci"]], leftover: "luck" } } }), { character, worn }).snapshot.goalSwing, undefined);
  for (const bad of [{ weapon: "Axe", speed: 0, stamina: 90 }, { weapon: "Axe", speed: 3, stamina: -1 }, { weapon: "Axe", speed: 3, stamina: 90, x: 1 }, { weapon: 7, speed: 3, stamina: 90 }])
    assert.match(runSettingsError({ goalSwing: bad }, "settings")!, /settings\.goalSwing must be/);
});

// Issue #302: the cap of a swing-time goal is stored with the swing (`goalSsi`), not guessed from the profile's SSI cap, so
// a goal needing exactly SSI 60 (the formula's cap) still holds the step credit. A slow weapon one stamina band up reaches
// faster swings that would credit more than 60.
test("[fast] goals: a swing-time goal needing exactly SSI 60 still caps the step credit; 59 caps at 59, and 61 is past the cap", () => {
  const every = (seconds: number): Goals => ({ ranks: [["ssi"]], leftover: "none", swing: { mode: "every", seconds } });
  assert.deepEqual([goalSsiCap(every(2.75), 4.75, 0), goalSsiCap(every(5.25), 8.75, 0), goalSsiCap(every(2.25), 4, 0)], [59, 60, null], "SSI 59, exactly 60, and 61 (past the cap: no goal cap)");
  const pools = { oneHanded: [{ serial: 1, name: "Maul", slot: "oneHanded", props: {}, speed: 4 }] }, current = { oneHanded: pools.oneHanded[0]! };
  const credits = (goalSsi?: number) => stepsFor({ swing: { stamBase: 80, refStamina: 95, steps: true, ...(goalSsi != null ? { goalSsi } : {}) }, weights: { ssi: 1 }, caps: { ssi: goalSsi ?? 60 } }, pools, current, { min: 0, max: 150 }).ssiSteps!.map((p) => p.credit);
  for (const cap of [59, 60]) assert.equal(Math.max(...credits(cap)), cap, `a goal of SSI ${cap} credits no point past it`);
  assert.ok(Math.max(...credits()) > 60, "no goal: a faster swing one band up keeps its full price");
});

test("[fast] goals: a spec read back recompiles the weights its goals set; weights set by hand are kept", () => {
  const goals: Goals = { ranks: [["ssi"], ["hci"]], leftover: "luck" }, c = compileGoals(goals, { tagPenalty: -25 });
  const edited = profileFromSpec({ intent: { weights: { ...c.weights, ssi: 99 }, goals } });
  assert.deepEqual([edited.weights, edited.swingSteps], [c.weights, true], "a hand-edited file holds what the goals set");
  const own = profileFromSpec({ intent: { weights: { luck: 3 }, goals: { ...goals, ownWeights: true } } });
  assert.deepEqual([own.weights, own.swingSteps], [{ luck: 3 }, undefined]);
});

test("[fast] goals: every built-in template's weights and swing-step switch are what its goals compile to", () => {
  for (const shard of ["uoalive", "generic-osi"]) {
    const templates = (JSON.parse(readFileSync(new URL(`./data/templates/${shard}.json`, import.meta.url), "utf8")) as { templates: TemplateMap }).templates;
    for (const [id, t] of Object.entries(templates)) {
      const { goals, weights, swingSteps } = t.spec.intent;
      assert.ok(goals, `${shard} ${id} has goals`);
      assert.equal(goalsError(goals, `${shard} ${id}`), null);
      assert.deepEqual(compileGoals(goals, weights), { weights, swingSteps: !!swingSteps }, `${shard} ${id}`);
    }
    for (const id of ["melee", "caster"]) assert.ok(templates[id], `${shard} ${id}`);
    assert.deepEqual(templates.melee!.spec.intent.goals, { ranks: [["ssi"], ["hci", "dci"], ["di"]], swing: { mode: "fastest" }, leftover: "luck" });
    assert.deepEqual(templates.caster!.spec.intent.goals, { ranks: [["fc", "fcr"], ["lmc"], ["lrc"], ["sdi"]], leftover: "caster" });
  }
});

// A seeded fuzz: random goals over two to four slots of one to three pieces each, every piece carrying a few of KEYS.
const KEYS = ["ssi", "hci", "dci", "di", "luck", "lmc", "dexBonus", "manaRegen"];
const SLOTS = ["helmet", "chest", "ring", "bracelet"];
type Suit = Record<string, { serial: number; name: string; slot: string; props: Record<string, number> } | null>;
const totals = (s: Suit): Record<string, number> => { const t: Record<string, number> = {}; for (const it of Object.values(s)) for (const [k, v] of Object.entries(it?.props || {})) t[k] = (t[k] || 0) + v; return t; };
test("[fast] goals fuzz: a build from goals is the build from their weights and the goals' brute-force best; trades are real ones", () => {
  const rnd = core.optMulberry32(292), int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  let serial = 1, traded = 0;
  for (let n = 0; n < 300; n++) {
    const slots = SLOTS.filter(() => rnd() < 0.7).slice(0, 4);
    if (slots.length < 2) slots.splice(0, slots.length, "helmet", "ring");
    const pools: OptPools = Object.fromEntries(slots.map((slot) => [slot, Array.from({ length: int(1, 3) }, () => ({ serial: serial++, name: `p${serial}`, slot, props: Object.fromEntries(KEYS.filter(() => rnd() < 0.35).map((k) => [k, int(1, 30)])) }))]));
    // random goals: one to five properties, each linked to the one above one time in four
    const picked = KEYS.filter(() => rnd() < 0.5).slice(0, 5), ranks: string[][] = [];
    for (const k of picked.length ? picked : ["hci"]) if (ranks.length && rnd() < 0.25) ranks.at(-1)!.push(k); else ranks.push([k]);
    const goals: Goals = { ranks, leftover: GOAL_LEFTOVERS[int(0, 3)]!, ...(ranks.flat().includes("ssi") ? { swing: { mode: "fastest" as const } } : {}) };
    const c = compileGoals(goals, { tagPenalty: -25 });
    // planned as the page and build_suit plan a build: the spec with its goals, and the same spec with the weights alone
    const plan = (intent: NonNullable<BuildSpecSource["intent"]>) => planBuild(buildSpec({ intent }), { character: null, worn: [] }).profile;
    const fromGoals = plan({ weights: c.weights, swingSteps: c.swingSteps, goals }), fromWeights = plan({ weights: c.weights, swingSteps: c.swingSteps });
    const opts = { seed: 1, restarts: 4, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 };
    const a = core.optimizeSuit(pools, {}, fromGoals, opts), b = core.optimizeSuit(pools, {}, fromWeights, opts);
    const label = `instance ${n}: ${JSON.stringify(goals)}`;
    assert.equal(a.proven, true, label);
    assert.deepEqual(Object.fromEntries(slots.map((s) => [s, a.best[s]?.serial ?? null])), Object.fromEntries(slots.map((s) => [s, b.best[s]?.serial ?? null])), label);
    assert.equal(a.score, b.score, label);
    // the oracle scores every suit from the goals themselves: each rank's importance, the spare group's 5, per point of a typical range
    const imp = new Map<string, number>(goals.ranks.flatMap((r, i) => r.map((k) => [k, [100, 80, 65, 50, 40][i] ?? 15] as [string, number])));
    for (const k of LEFTOVER_GROUPS[goals.leftover]) if (!imp.has(k)) imp.set(k, 5);
    const caps = fromGoals.caps, score = (s: Suit): number => { const t = totals(s); return [...imp].reduce((sum, [k, v]) => sum + (v / (typicalRange(k)! * IMPORTANCE_K)) * Math.min(t[k] || 0, caps[k] ?? Infinity), 0); };
    let best = -Infinity, all: Suit[] = [{}];
    for (const slot of slots) all = all.flatMap((s) => [null, ...pools[slot]!].map((it) => ({ ...s, [slot]: it })));
    for (const s of all) best = Math.max(best, score(s));
    assert.ok(Math.abs(score(a.best as Suit) - best) < 1e-6 * Math.max(1, best), `${label}: ${score(a.best as Suit)} against the best ${best}`);
    // the trades from a random suit worn now to the build's: each one a higher goal down and a lower one up, and one whenever there is such a pair
    const now = all[int(0, all.length - 1)]!, before = totals(now), after = totals(a.best as Suit);
    const held = (k: string, t: Record<string, number>): number => Math.min(t[k] || 0, caps[k] ?? Infinity), rank = (k: string): number => goals.ranks.findIndex((r) => r.includes(k));
    const trades = goalTrades(goals, before, after, caps);
    for (const t of trades) {
      assert.ok(held(t.key, after) < held(t.key, before) && t.from === held(t.key, before) && t.to === held(t.key, after), label);
      for (const u of t.ups) assert.ok(rank(u.key) > rank(t.key) && u.by === held(u.key, after) - held(u.key, before) && u.by > 0, label);
    }
    const down = ranks.flat().filter((k) => held(k, after) < held(k, before)), up = ranks.flat().filter((k) => held(k, after) > held(k, before));
    assert.equal(trades.length > 0, down.some((d) => up.some((u) => rank(u) > rank(d))), `${label}: a trade exactly when one was made`);
    traded += trades.length ? 1 : 0;
  }
  assert.ok(traded > 20, `the fuzz made trades (${traded})`);
});

// A second seeded fuzz with a character (review of #301): the demo characters' own swings (Kestrel's 3 s War Axe at 100
// stamina, Dorran's 2.25 s staff at 70), random pieces carrying SSI and the Stamina pool, and random goals that rank Swing
// speed as the fastest swing or a swing every N s. Each build is planned as the page plans it (planBuild with the worn suit,
// the worker's step table) and its proven score must equal an oracle that reads only the goals: each rank's importance per
// point, and for Swing speed the suit's own swing from the formula, priced at the worn stamina and held at the goal's step.
// Two broken builds (the step table without the goal's credit cap, and goals compiled with their ranks reversed) must each
// miss the oracle at least once, so the test can tell.
test("[fast] goals fuzz with a swing: a build from goals scores the goals' own best, swing time included", () => {
  const rnd = core.optMulberry32(301), int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const ssiAtLeast = (n: number, t: number): number => Math.floor((100 * n) / (t + 1)) - 99;
  let serial = 50_000, everyRuns = 0, missUncapped = 0, missReversed = 0;
  for (let n = 0; n < 120; n++) {
    const who = n % 2 ? "Dorran" : "Kestrel", worn = wornBy(who), character = inv.characters[who]!;
    const held = heldWeapon(Object.fromEntries(worn.filter((it) => it.slot).map((it) => [it.slot!, toOptItem(it)])))!;
    const slots = ["helmet", "chest", "ring", "bracelet"].filter(() => rnd() < 0.8);
    if (slots.length < 2) slots.splice(0, slots.length, "helmet", "ring");
    const pools: OptPools = Object.fromEntries(slots.map((slot) => [slot, Array.from({ length: int(1, 3) }, () => {
      const props: Record<string, number> = {};
      if (rnd() < 0.6) props.ssi = int(1, 25);
      if (rnd() < 0.5) props.stamPool = int(1, 25);
      for (const k of ["hci", "dci", "luck"]) if (rnd() < 0.4) props[k] = int(1, 20);
      return { serial: serial++, name: `p${serial}`, slot, props };
    })]));
    // Swing speed and some of HCI, DCI and Luck in a random order, a row linked to the one above one time in five
    const order = ["ssi", ...["hci", "dci", "luck"].filter(() => rnd() < 0.6)].map((k) => [rnd(), k] as const).sort((x, y) => x[0] - y[0]).map(([, k]) => k), ranks: string[][] = [];
    for (const k of order) if (ranks.length && rnd() < 0.2) ranks.at(-1)!.push(k); else ranks.push([k]);
    // a swing time from the worn weapon's steps at the worn stamina, one time in two
    const plan0 = planBuild(buildSpec({ intent: { weights: {} } }), { character, worn }).profile, steps = swingSteps(held.speed!, plan0.swing!.refStamina);
    const every = rnd() < 0.5 && steps.length ? steps[int(0, steps.length - 1)]!.seconds : null;
    const goals: Goals = { ranks, leftover: rnd() < 0.5 ? "none" : "luck", swing: every != null ? { mode: "every", seconds: every } : { mode: "fastest" } };
    const built = (g: Goals, uncapped = false): { score: number; best: Suit } => {
      const c = compileGoals(g), prof = planBuild(buildSpec({ intent: { weights: c.weights, swingSteps: c.swingSteps, goals: g } }), { character, worn }).profile;
      const reach = propertyReach(pools as never, {}, slots, slots, ["stamPool", "ssi"]);
      const hand = { [held.slot!]: [held] }, cur = { [held.slot!]: held };
      const table = uncapped ? stepTable({ speedS: held.speed!, stamBase: prof.swing!.stamBase, refStamina: prof.swing!.refStamina, share: 0, stamRange: reach.stamPool!, ssiMax: reach.ssi!.max })
        : stepsFor(prof, hand, cur, reach.stamPool!).ssiSteps!;
      const r = core.optimizeSuit(pools, {}, { ...prof, ssiSteps: table }, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
      assert.equal(r.proven, true);
      return { score: r.score, best: r.best as Suit };
    };
    // the oracle: the goals' importances per point, and Swing speed's credit from the suit's own swing, held at the goal's step
    const ref = planBuild(buildSpec({ intent: { ...compileGoals(goals), goals } }), { character, worn }).profile, { stamBase, refStamina } = ref.swing!;
    const nRef = Math.round(4 * held.speed!) - Math.floor(refStamina / 30), goalCap = every != null ? ref.caps.ssi! : Infinity;
    const imp = new Map<string, number>(ranks.flatMap((r, i) => r.map((k) => [k, [100, 80, 65, 50][i] ?? 40] as [string, number])));
    if (goals.leftover === "luck" && !imp.has("luck")) imp.set("luck", 5);
    const score = (s: Suit): number => {
      const t = totals(s), credit = Math.min(goalCap, Math.max(0, ssiAtLeast(nRef, swingTicks(held.speed!, stamBase + (t.stamPool || 0), Math.min(60, t.ssi || 0)))));
      return [...imp].reduce((sum, [k, v]) => sum + (v / (typicalRange(k)! * IMPORTANCE_K)) * (k === "ssi" ? credit : Math.min(t[k] || 0, ref.caps[k] ?? Infinity)), 0);
    };
    let all: Suit[] = [{}];
    for (const slot of slots) all = all.flatMap((s) => [null, ...pools[slot]!].map((it) => ({ ...s, [slot]: it })));
    const best = Math.max(...all.map(score)), close = (x: number): boolean => Math.abs(x - best) < 1e-6 * Math.max(1, best);
    const got = built(goals), label = `instance ${n} (${who}): ${JSON.stringify(goals)}`;
    assert.ok(close(score(got.best)) && Math.abs(got.score - best) < 1e-6 * Math.max(1, best), `${label}: built ${score(got.best)} (core ${got.score}) against the goals' best ${best}`);
    if (every != null) { everyRuns++; if (!close(score(built(goals, true).best))) missUncapped++; }
    if (!close(score(built({ ...goals, ranks: [...ranks].reverse() }).best))) missReversed++;
  }
  assert.ok(everyRuns > 20, `swing-time goals (${everyRuns})`);
  assert.ok(missUncapped > 0, "a step table without the goal's credit cap misses the goals' best at least once");
  assert.ok(missReversed > 0, "goals compiled with their ranks reversed miss the goals' best at least once");
});
