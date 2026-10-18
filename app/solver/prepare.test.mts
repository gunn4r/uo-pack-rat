// prepare.test.mts — `app/solver/prepare.mts`, everything a build does to its input before the search, and the run key (issue #338).
//
// `[fast]`: on the fixture's melee template, the key is the run key of the input as prepared (every transform is before it); the search defaults are filled in without touching the caller's options; a rarity preference stamps a tie cost on every candidate and worn piece, and none without one; Resisting Spells steps the pool cannot reach are dropped before the key, so a profile carrying them keys as one without; a hard floor's raised bonus is on the prepared profile, and past its cap the scale diagnostic says so; an unreachable floor is said before the search; and the SSI step table is the one the worker used to work out for itself, from the prepared profile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cell } from "../solver-fixture.mts";
import { DEFAULT_SLOTS, HARD_FLOOR_BONUS, poolStepsFor } from "../mip.mts";
import { RUN_DEFAULTS } from "../run-settings.mts";
import { runKey } from "../runs-lib.mts";
import { getRules, type Inventory } from "../vault-lib.mts";
import { prepareSolve } from "./prepare.mts";

const melee = () => cell("melee") as unknown as { pools: Record<string, Array<{ serial: number; speed?: number; props: Record<string, number> }>>; current: Record<string, { serial: number; speed?: number; props: Record<string, number> } | null>; profile: Record<string, unknown> };

test("[fast] prepare: the key covers the prepared input, the defaults fill in, and the tie costs are stamped", () => {
  const { pools, current, profile } = melee(), opts = { optionalSlots: ["talisman"] };
  const { input, key } = prepareSolve({ pools, current, profile, opts, weaponMustHave: ["slayer"], onlyRoots: [7] });
  assert.equal(key, runKey({ pools: input.pools, current: input.current, profile: input.profile, opts: input.opts, weaponMustHave: ["slayer"], onlyRoots: [7] }));
  assert.deepEqual([input.opts.seed, input.opts.restarts], [RUN_DEFAULTS.seed, RUN_DEFAULTS.restarts]);
  assert.deepEqual(opts, { optionalSlots: ["talisman"] }, "the caller's options are left as they were");
  assert.equal(Object.values(input.pools).flat().some((it) => "tieCost" in (it as object)), false, "no preference, no tie cost");

  const ladder = getRules().rarity || [], serials = [...Object.values(pools).flat(), ...Object.values(current)].flatMap((it) => (it ? [it.serial] : []));
  const inv = { items: Object.fromEntries(serials.map((s, i) => [s, { rarity: ladder[i % ladder.length] }])) } as unknown as Inventory;
  const ranked = prepareSolve({ pools, current, profile, opts: { tieBreak: { rarity: "lower", tolerance: 10 } }, rarity: { inv, ladder } });
  assert.ok(Object.values(ranked.input.pools).flat().every((it) => typeof (it as { tieCost?: unknown }).tieCost === "number"), "every candidate");
  assert.ok(Object.values(ranked.input.current).every((it) => it == null || typeof (it as { tieCost?: unknown }).tieCost === "number"), "every worn piece");
  assert.notEqual(ranked.key, prepareSolve({ pools, current, profile, opts: { tieBreak: { rarity: "higher", tolerance: 10 } }, rarity: { inv, ladder } }).key);
});

test("[fast] prepare: unreachable resist steps, the hard-floor bonus and the diagnostics come before the key", () => {
  const { pools, current, profile } = melee();
  // a pool with no Resisting Spells pieces reaches none of the steps
  const bare = Object.fromEntries(Object.entries(pools).map(([s, l]) => [s, l.map((it) => ({ ...it, props: Object.fromEntries(Object.entries(it.props).filter(([k]) => k !== "sk:resisting spells")) }))]));
  const { resistSteps: _drop, ...noSteps } = profile;
  const stepped = { ...profile, resistSteps: [{ at: 15, mins: { physResist: 50, fireResist: 50, coldResist: 50, poisonResist: 50, energyResist: 50 } }] };
  assert.equal(prepareSolve({ pools: bare, current: {}, profile: stepped, opts: {} }).key, prepareSolve({ pools: bare, current: {}, profile: noSteps, opts: {} }).key);

  const weights = profile.weights as Record<string, number>, floors = (profile.floors || {}) as Record<string, number>;
  const heavy = prepareSolve({ pools, current, profile: { ...profile, weights: { ...weights, luck: 5e3 }, floors: { ...floors, hci: 10 }, hardFloors: ["hci"] }, opts: {} });
  assert.ok((heavy.input.profile as { hardFloorBonus?: number }).hardFloorBonus! > HARD_FLOOR_BONUS, "raised for a pool whose weights could outweigh it");
  const huge = prepareSolve({ pools, current, profile: { ...profile, weights: { ...weights, luck: 5e6 }, floors: { ...floors, hci: 10 }, hardFloors: ["hci"] }, opts: {} });
  assert.ok(huge.scaleDiagnostics.some((d) => d.code === "requirement_outweighed"));
  const far = prepareSolve({ pools, current, profile: { ...profile, floors: { ...floors, hci: 900 }, hardFloors: ["hci"] }, opts: {} });
  assert.ok(far.preDiagnostics.some((d) => d.code === "floor_unreachable" && d.property === "hci"));
});

test("[fast] prepare: the SSI step table is the one the worker worked out from the prepared profile", () => {
  const { pools, current, profile } = melee();
  const w = pools.oneHanded!.find((it) => it.speed)!, speed = w.speed;
  const one = { ...pools, oneHanded: pools.oneHanded!.filter((it) => it.speed === speed), twoHanded: (pools.twoHanded || []).filter((it) => it.speed === speed) };
  const worn = { ...current, oneHanded: w, twoHanded: null };
  const swingProfile = { ...profile, weights: { ...(profile.weights as Record<string, number>), ssi: 3 }, swing: { stamBase: 120, refStamina: 150, steps: true } };
  const { input } = prepareSolve({ pools: one, current: worn, profile: swingProfile, opts: { optionalSlots: ["talisman"] } });
  assert.ok(input.ssiSteps && input.ssiSteps.length > 0);
  assert.deepEqual(input.ssiSteps, poolStepsFor(input.profile as Parameters<typeof poolStepsFor>[0], input.pools as Parameters<typeof poolStepsFor>[1], input.current as Parameters<typeof poolStepsFor>[2], input.opts.optionalSlots as string[]).ssiSteps);
  assert.equal(input.swingNote, null);
  // a search over fewer slots gets the table of those slots, as the worker built it from opts.slots
  const slots = DEFAULT_SLOTS.filter((s) => s === "oneHanded" || s === "twoHanded" || s === "talisman");
  const narrowed = prepareSolve({ pools: one, current: worn, profile: swingProfile, opts: { optionalSlots: ["talisman"], slots } }).input;
  assert.deepEqual(narrowed.ssiSteps, poolStepsFor(narrowed.profile as Parameters<typeof poolStepsFor>[0], narrowed.pools as Parameters<typeof poolStepsFor>[1], narrowed.current as Parameters<typeof poolStepsFor>[2], ["talisman"], slots).ssiSteps);
  assert.notDeepEqual(narrowed.ssiSteps, input.ssiSteps, "the slots change the table here");
  assert.equal("ssiSteps" in input.profile, false, "the table is not on the profile, so the key is as before");
});
