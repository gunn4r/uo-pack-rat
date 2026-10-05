// manual-model.test.mts — app/ui/manual-model.mts, the Suit Builder Manual mode's pure logic (issue #12): a total
// capped with what is wasted and the line under it, the caps in paperdoll terms, the picker's slot filter, the
// one-hand/two-hand rule against the optimizer's own, a saved suit read back, the slots whose piece left the scans,
// and a picker row's delta. Lives in app/ for the reason app/ui-render.test.mts gives.
// Tags: [fast]. Run: node --test app/manual-model.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setRules, effectiveProfile, OPTIMIZER_SLOTS, SLOT_LABELS } from "./vault-lib.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { optIsValidAssignment } from "../scripts/optimizer-core.mts";
import { capped, capLine, paperdollTotals, manualCaps, slotQuery, handConflict, handNote, savedSlots, missingSlots, deltaKeys, slotDelta, STRIP_KEYS } from "./ui/manual-model.mts";

setRules(JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as RulesV1);

test("[fast] manual model: a total over its cap shows the cap and what is wasted, and the line under it says so", () => {
  assert.deepEqual(capped(49, 40), { shown: 40, wasted: 9 });
  assert.deepEqual(capped(40, 40), { shown: 40, wasted: 0 });
  assert.deepEqual(capped(27, 40), { shown: 27, wasted: 0 });
  assert.deepEqual(capped(12, undefined), { shown: 12, wasted: 0 }, "a stat has no cap");
  assert.deepEqual(capLine(49, 40), { text: "+9 wasted", tone: "warn" });
  assert.deepEqual(capLine(40, 40), { text: "At cap", tone: "ok" });
  assert.deepEqual(capLine(27, 40), { text: "13 to cap", tone: "muted" });
  assert.deepEqual(capLine(12, null), { text: "No cap", tone: "muted" });
  assert.deepEqual(capLine(0, 40), { text: "Nothing yet", tone: "muted" });
});

test("[fast] manual model: resists count in paperdoll terms, the character's Resisting Spells and race caps included", () => {
  assert.deepEqual(paperdollTotals({ fireResist: 30, lrc: 20 }, 40), { physResist: 40, fireResist: 70, coldResist: 40, poisonResist: 40, energyResist: 40, lrc: 20 });
  const raw = manualCaps(effectiveProfile({}, null));
  assert.equal(raw.energyResist, 70, "no character: the shard's caps");
  assert.equal(raw.lrc, 100); assert.equal(raw.lmc, 40);
  const elf = manualCaps(effectiveProfile({ race: "elf", resistCaps: { fireResist: 95 } }, { skills: { "Resisting Spells": { value: 100 } } } as never));
  assert.equal(elf.energyResist, 75, "an Elf's Energy cap");
  assert.equal(elf.fireResist, 95, "the player's override");
  assert.equal(elf.physResist, 70, "the cap stays in paperdoll terms, whatever the Resisting Spells bonus");
});

test("[fast] manual model: the picker's filter is the slot itself, so the two-handed slot lists two-handers and shields", () => {
  for (const slot of OPTIMIZER_SLOTS) assert.deepEqual(slotQuery(slot), { slot: [slot] });
  assert.equal(SLOT_LABELS.twoHanded, "Weapon 2H / Shield");
});

test("[fast] manual model: the hand rule clears what the optimizer would refuse, and nothing else", () => {
  type Piece = { serial: number; name: string; slot: string; props: Record<string, number>; twoHanded?: true };
  const sword: Piece = { serial: 1, name: "Katana", slot: "oneHanded", props: {} };
  const shield: Piece = { serial: 2, name: "Heater Shield", slot: "twoHanded", props: {} };
  const bow: Piece = { serial: 3, name: "Bow", slot: "twoHanded", props: {}, twoHanded: true };
  const ring: Piece = { serial: 4, name: "Ring", slot: "ring", props: {} };
  const cases: Array<[string, Piece, Record<string, Piece>, string | null]> = [
    ["twoHanded", bow, { oneHanded: sword, ring }, "oneHanded"],
    ["oneHanded", sword, { twoHanded: bow }, "twoHanded"],
    ["twoHanded", shield, { oneHanded: sword }, null],
    ["oneHanded", sword, { twoHanded: shield }, null],
    ["twoHanded", bow, { twoHanded: shield }, null],
    ["ring", ring, { oneHanded: sword, twoHanded: shield }, null],
  ];
  for (const [slot, pick, suit, want] of cases) {
    const cleared = handConflict(slot, pick, suit);
    assert.equal(cleared, want, `${pick.name} into ${slot}`);
    const after: Record<string, Piece> = { ...suit, [slot]: pick };
    if (cleared) delete after[cleared];
    assert.ok(optIsValidAssignment(after), `the suit after ${pick.name} is one the optimizer accepts`);
    if (!cleared) assert.equal(optIsValidAssignment({ ...suit, [slot]: pick }), true, "nothing is cleared that did not need to be");
  }
  assert.equal(handNote("Katana", "Weapon (1H)"), "Katana left Weapon (1H): a two-handed weapon takes both hands.");
});

test("[fast] manual model: a saved suit keeps only known slots holding whole serials, and missing serials are found in slot order", () => {
  assert.deepEqual(savedSlots({ ring: 5, cloak: 0, helmet: 2.5, feet: 9, neck: "7", twoHanded: 11 }), { ring: 5, twoHanded: 11 });
  assert.deepEqual(savedSlots(null), {});
  assert.deepEqual(savedSlots([1, 2]), {});
  assert.deepEqual(missingSlots({ twoHanded: 11, ring: 5, helmet: 3 }, { 5: {} }), ["helmet", "twoHanded"]);
  assert.deepEqual(missingSlots({}, {}), []);
});

test("[fast] manual model: a row's delta says what moves, up to the cap, gains and losses apart", () => {
  const caps = manualCaps(effectiveProfile({}, null));
  const keys = deltaKeys({});
  assert.deepEqual(keys, STRIP_KEYS, "no profile: the strip's properties");
  const before = paperdollTotals({ lrc: 57, lmc: 27, fireResist: 60, dexBonus: 2 }, 0);
  const after = paperdollTotals({ lrc: 77, lmc: 35, fireResist: 52, dexBonus: 2 }, 0);
  const parts = slotDelta(before, after, keys, caps);
  assert.deepEqual(parts.map((p) => p.text), ["Fire −8 → 52", "LRC +20 → 77", "LMC +8 → 35"]);
  assert.deepEqual(parts.map((p) => p.tone), ["bad", "ok", "ok"]);
  assert.equal(parts.map((p) => p.text).join(" · "), "Fire −8 → 52 · LRC +20 → 77 · LMC +8 → 35");
  // Past the cap: only what counts is a gain; a change wholly past it counts for nothing.
  const over = slotDelta({ lmc: 36, lrc: 100 }, { lmc: 48, lrc: 110 }, keys, caps);
  assert.deepEqual(over, [{ key: "lrc", text: "LRC +10 over cap", tone: "muted" }, { key: "lmc", text: "LMC +4 → 40", tone: "ok" }]);
  // Uncapped stats count whole; nothing that stays the same is listed.
  assert.deepEqual(slotDelta({ intBonus: 4, hci: 5 }, { intBonus: 12, hci: 5 }, keys, caps).map((p) => p.text), ["INT +8 → 12"]);
  // A floor or weight in the profile adds its property after the strip's.
  const withProfile = deltaKeys({ floors: { lrc: 100, hpRegen: 2 }, weights: { manaRegen: 3, tagPenalty: -25 } });
  assert.deepEqual(withProfile.slice(STRIP_KEYS.length), ["hpRegen", "manaRegen"]);
  assert.deepEqual(slotDelta({}, { manaRegen: 3, luck: 100 }, withProfile, caps).map((p) => p.text), ["MR +3 → 3"], "a property neither in the strip nor the profile is left out");
});
