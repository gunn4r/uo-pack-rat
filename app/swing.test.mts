// swing.test.mts — swing speed (`app/swing.mts`, issue #217): the formula on the worked examples (a 3.5 s weapon at stamina 88 needs SSI 51 for 1.75 s and swings at 2.0 s with 45; at 95, 38 for 1.75 s and 58 for 1.5 s), the 1.25 s floor, the 60 cap, the least-SSI closed form against a scan of the formula (exact-integer edges included), stamina with a Bless share, the weapon speed a pool shares (one speed, two, a shield only, a two-hander and a one-hander alike), the step list a person reads, and the solvers' step table: its best reached credit equals the credit worked out from the swing itself for every SSI and stamina (negative buff shares, reference bands below and above, a share large enough that a step needs no gear SSI), with no point another one beats. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { delayText, heldWeapon, ssiForTicks, ssiShareOf, staminaOf, stepsFor, stepTable, swingOf, swingSeconds, swingSteps, swingTicks, weaponSpeedOf, type SsiStepPoint } from "./swing.mts";

test("[fast] the worked examples: 3.5 s at stamina 88 needs 51 for 1.75 s and swings at 2.0 s with 45; at 95, 38 and 58", () => {
  assert.equal(ssiForTicks(3.5, 88, 7), 51);
  assert.equal(swingSeconds(3.5, 88, 45), 2);
  assert.equal(swingSeconds(3.5, 88, 51), 1.75);
  assert.equal(swingSeconds(3.5, 88, 50), 2);
  assert.equal(ssiForTicks(3.5, 95, 7), 38);
  assert.equal(ssiForTicks(3.5, 95, 6), 58);
  assert.equal(swingSeconds(3.5, 95, 45), 1.75);
  assert.equal(swingSeconds(3.5, 0, 0), 3.5);
});

test("[fast] the swing never gets faster than 1.25 s, and SSI past 60 counts as 60", () => {
  assert.equal(swingSeconds(2, 150, 60), 1.25);   // N = 8 − 5 = 3 ticks would be faster
  assert.equal(swingTicks(2, 150, 0), 5);
  assert.equal(swingTicks(3.5, 95, 90), swingTicks(3.5, 95, 60));
  assert.equal(ssiForTicks(3.5, 95, 5), null, "1.25 s takes 84, past the cap");
  assert.equal(ssiForTicks(3.5, 95, 4), null);
});

test("[fast] the least SSI for a delay matches a scan of the formula, exact-integer edges included", () => {
  // 100 · 12 / (7 + 1) = 150 exactly: 51 reaches 7 ticks, 50 gives 1200 / 150 = 8 exactly
  assert.equal(swingTicks(3.5, 88, 51), 7);
  assert.equal(swingTicks(3.5, 88, 50), 8);
  for (let q = 5; q <= 24; q++) for (let stamina = 0; stamina <= 180; stamina += 7) for (let t = 5; t <= 22; t++) {
    const speed = q / 4;
    let least: number | null = null;
    for (let s = 0; s <= 60 && least == null; s++) if (swingTicks(speed, stamina, s) <= t) least = s;
    assert.equal(ssiForTicks(speed, stamina, t), least, `speed ${speed}, stamina ${stamina}, ${t} ticks`);
  }
});

test("[fast] the step list: every delay SSI reaches at this stamina, slowest first, less the ones the buffs alone give", () => {
  assert.deepEqual(swingSteps(3.5, 95), [{ seconds: 2.5, ssi: 1 }, { seconds: 2.25, ssi: 11 }, { seconds: 2, ssi: 23 }, { seconds: 1.75, ssi: 38 }, { seconds: 1.5, ssi: 58 }]);
  assert.deepEqual(swingSteps(3.5, 95, 15).map((s) => s.seconds), [2, 1.75, 1.5]);
  assert.deepEqual(swingSteps(2, 150), [], "already at 1.25 s");
  assert.equal(delayText(2), "2.0 s");
  assert.equal(delayText(1.75), "1.75 s");
  assert.equal(delayText(1.5), "1.5 s");
});

test("[fast] stamina is raw DEX plus the gear's Stamina pool plus the buffs' shares on DEX and the pool", () => {
  assert.equal(staminaOf(80, { stamPool: 15 }), 95);
  assert.equal(staminaOf(80, { stamPool: 15 }, { dexBonus: 10, stamPool: 10 }), 115);   // Bless's DEX share and a potion's stamina
  assert.equal(staminaOf(74, {}), 74);
});

test("[fast] the weapon speed a pool shares: one speed, two speeds, a shield only, a two-hander and a one-hander of the same speed", () => {
  const sword = { speed: 3.5 }, axe = { speed: 3.5, twoHanded: true }, dagger = { speed: 2 }, shield = {}, book = {};
  assert.deepEqual(weaponSpeedOf({ oneHanded: [sword] }, {}), { speed: 3.5, reason: null });
  assert.deepEqual(weaponSpeedOf({ oneHanded: [sword, dagger] }, {}), { speed: null, reason: "the pool holds weapons with 2 different speeds" });
  assert.deepEqual(weaponSpeedOf({ twoHanded: [shield], oneHanded: [book] }, {}), { speed: null, reason: "no weapon in the pool has a known speed" });
  assert.deepEqual(weaponSpeedOf({ twoHanded: [axe, shield], oneHanded: [sword] }, {}), { speed: 3.5, reason: null });
  assert.deepEqual(weaponSpeedOf({ oneHanded: [] }, { oneHanded: dagger }), { speed: 2, reason: null }, "a locked slot keeps the worn weapon");
  // with the one-handed slot locked to its worn weapon, a two-hander is no candidate (it would leave that hand empty)
  assert.deepEqual(weaponSpeedOf({ oneHanded: [], twoHanded: [{ speed: 3.75, twoHanded: true }, shield] }, { oneHanded: sword }, ["twoHanded"]), { speed: 3.5, reason: null });
  assert.equal(weaponSpeedOf({ oneHanded: [], twoHanded: [{ speed: 3.75, twoHanded: true }] }, { oneHanded: sword }, ["oneHanded", "twoHanded"]).speed, null, "an optional one-hand slot leaves room for it");
  assert.equal(heldWeapon({ oneHanded: sword, twoHanded: shield }), sword);
  assert.equal(heldWeapon({ oneHanded: null, twoHanded: axe }), axe);
  assert.equal(heldWeapon({ oneHanded: book }), null);
});

// The credit a suit's own swing is worth, from the formula alone: the gear SSI the delay it gets would cost at the reference stamina.
function directCredit(speed: number, stamBase: number, refStamina: number, share: number, gearSsi: number, gearStam: number): number {
  const t = swingTicks(speed, stamBase + gearStam, Math.min(60, gearSsi + share));
  const nRef = Math.round(4 * speed) - Math.floor(Math.max(0, refStamina) / 30);
  return Math.max(0, Math.floor((100 * nRef) / (t + 1)) - 99 - share);
}
const reached = (table: SsiStepPoint[], ssi: number, stam: number): number => Math.max(0, ...table.filter((p) => ssi >= p.ssi && stam >= p.stam).map((p) => p.credit));

test("[fast] the step table's best reached credit is the credit of the suit's own swing, for every SSI and stamina", () => {
  let cases = 0;
  for (const speed of [1.75, 2.5, 3.25, 3.5, 4, 5]) for (const stamBase of [10, 50, 74, 80, 119]) for (const refGear of [0, 9, 20, 40]) for (const share of [-10, 0, 10, 15, 45]) {
    const stamRange = { min: -5, max: 45 }, refStamina = stamBase + refGear;
    const table = stepTable({ speedS: speed, stamBase, refStamina, share, stamRange });
    for (let stam = stamRange.min; stam <= stamRange.max; stam += 2) for (let ssi = -15; ssi <= 75; ssi++) {
      assert.equal(reached(table, ssi, stam), directCredit(speed, stamBase, refStamina, share, ssi, stam), `speed ${speed}, base ${stamBase}, ref ${refStamina}, share ${share}, ssi ${ssi}, stam ${stam}`);
      cases++;
    }
    for (const p of table) assert.ok(!table.some((q) => q !== p && q.credit >= p.credit && q.ssi <= p.ssi && q.stam <= p.stam), `a point another beats was kept: ${JSON.stringify(p)}`);
  }
  assert.ok(cases > 100000);
});

test("[fast] the step table on the issue's numbers: credits are SSI at the reference stamina, a band up reached by stamina keeps that price", () => {
  // raw DEX 80, worn stamina 100 (band 3), gear pool 0-30: bands 2 and 3
  const t = stepTable({ speedS: 3.5, stamBase: 80, refStamina: 100, share: 0, stamRange: { min: 0, max: 30 } });
  assert.deepEqual(t.find((p) => p.ssi === 38), { ssi: 38, stam: 10, credit: 38 }, "1.75 s at stamina 90 or more");
  assert.ok(t.some((p) => p.ssi === 51 && p.credit === 38 && p.stam <= 0), "1.75 s in band 2 takes 51");
  // the reference band below the reachable ones: stamina 89 prices 1.5 s at 72, which band 3 reaches with 58
  const low = stepTable({ speedS: 3.5, stamBase: 80, refStamina: 89, share: 0, stamRange: { min: 10, max: 30 } });
  assert.ok(low.some((p) => p.ssi === 58 && p.credit === 72), JSON.stringify(low));
  // Divine Fury's 10: every threshold drops by 10, and a step its share alone reaches needs no gear SSI
  const df = stepTable({ speedS: 3.5, stamBase: 80, refStamina: 100, share: 10, stamRange: { min: 0, max: 30 } });
  assert.ok(df.some((p) => p.ssi === 28 && p.credit === 28));
  // a share of 30 with the reference in band 2: band 3's 2.0 s needs 23, which the share alone gives, and is worth 4 (34 at stamina 89, less 30)
  const big = stepTable({ speedS: 3.5, stamBase: 80, refStamina: 89, share: 30, stamRange: { min: 0, max: 30 } });
  assert.ok(big.some((p) => p.ssi === -7 && p.stam === 10 && p.credit === 4), JSON.stringify(big));
});

test("[fast] stepsFor: steps only with a character's swing switched on, a positive SSI weight and one weapon speed", () => {
  const swing = { stamBase: 80, refStamina: 100, steps: true }, pools = { oneHanded: [{ speed: 3.5 }] }, range = { min: 0, max: 30 };
  const on = stepsFor({ swing, weights: { ssi: 8 }, caps: { ssi: 60 } }, pools, {}, range);
  assert.ok(on.ssiSteps && on.ssiSteps.length > 0);
  assert.equal(on.note, null);
  assert.deepEqual(stepsFor({ swing: { ...swing, steps: false }, weights: { ssi: 8 }, caps: {} }, pools, {}, range), { ssiSteps: null, note: null });
  assert.deepEqual(stepsFor({ weights: { ssi: 8 }, caps: {} }, pools, {}, range), { ssiSteps: null, note: null }, "no character");
  assert.deepEqual(stepsFor({ swing, weights: { ssi: -2 }, caps: {} }, pools, {}, range), { ssiSteps: null, note: null }, "a negative weight stays per point, unsaid");
  assert.deepEqual(stepsFor({ swing, weights: { ssi: 8 }, caps: {} }, { oneHanded: [{ speed: 3.5 }, { speed: 2 }] }, {}, range), { ssiSteps: null, note: "the pool holds weapons with 2 different speeds" });
  // the buffs' share: the cap before them less the gear's
  assert.equal(ssiShareOf({ caps: { ssi: 50 }, buffs: { caps: { ssi: 60 } } }), 10);
  assert.equal(ssiShareOf({ caps: { ssi: 60 } }), 0);
});

test("[fast] a suit's swing: stamina from the gear's pool, SSI with the buffs' share and the cap, the steps at that stamina", () => {
  const s = swingOf(3.5, 80, { ssi: 35, stamPool: 15 }, 10);
  assert.deepEqual({ stamina: s.stamina, ssi: s.ssi, seconds: s.seconds }, { stamina: 95, ssi: 45, seconds: 1.75 });
  assert.deepEqual(s.steps.map((x) => x.ssi), [11, 23, 38, 58], "steps the share alone reaches are left out");
  assert.equal(swingOf(3.5, 80, { ssi: 70 }, 10).ssi, 60);
});
