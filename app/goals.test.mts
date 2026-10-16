// goals.test.mts — the Suit Builder's goals (issue #292): ranked goals compiled to the weights the solvers score with, and a build from goals being the build from those weights.
//
// `[fast]`: `app/vault-lib.mts`'s `compileGoals`: the rank importances (100, 80, 65, 50, 40, 30, 25, 20, 15, then 15 for every later rank), linked properties sharing their rank's, the spare-points group at 5 less any member that is a goal, SSI by swing step on with a Swing speed goal in either swing mode, an empty list, the tag penalty kept, and the same goals always compiling to the same weights; `goalsError`; a goals change counting as one settings change (`settingsDiff`); `app/build-spec.mts`'s `planBuild` capping SSI at a swing-every-N-s goal's step for the weapon worn now (none for the fastest swing, nor for weights set by hand) and `app/swing.mts`'s step table keeping no point past that cap; every built-in template's weights and swing-step switch equal to what its goals compile to; and a seeded fuzz over small random pools: a build from random goals equals the build from their compiled weights and the brute-force best of the goals' own scoring, and the trade finder (`app/ui/builder-model.mts`'s `goalTrades`) names a trade exactly when a higher goal went down while a lower one went up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileGoals, foldSnapshots, goalsError, importanceOf, settingsDiff, toOptItem, typicalRange, IMPORTANCE_K, LEFTOVER_GROUPS, GOAL_LEFTOVERS, type Goals, type Item } from "./vault-lib.mts";
import { upgradeScan } from "./scan-schema.mts";
import { buildSpec, planBuild, type BuildSpecSource, type TemplateMap } from "./build-spec.mts";
import { heldWeapon, stepsFor } from "./swing.mts";
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
  const bad: Array<[unknown, RegExp]> = [
    [[], /goals must be an object/], [{ ranks: [["ssi"]], leftover: "luck", strategy: "strict" }, /goals\.strategy is not a goals setting/],
    [{ ranks: [[]], leftover: "luck" }, /ranks must be a list/], [{ ranks: [["tagPenalty"]], leftover: "luck" }, /ranks must be a list/],
    [{ ranks: [["__proto__"]], leftover: "luck" }, /ranks must be a list/], [{ ranks: [["ssi"], ["ssi"]], leftover: "luck" }, /names a property twice/],
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
  assert.deepEqual(settingsDiff(run(melee), run(moved)), ["goals: HCI = DCI › SSI › DI, spare points to luck"]);
  assert.deepEqual(settingsDiff(run(melee), run({ ...melee, swing: { mode: "every", seconds: 1.5 } })), ["goals: SSI 1.5 s › HCI = DCI › DI, spare points to luck"]);
  assert.deepEqual(settingsDiff(run(melee), run({ ...melee, leftover: "none" })), ["goals: SSI › HCI = DCI › DI, spare points to nothing"]);
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
