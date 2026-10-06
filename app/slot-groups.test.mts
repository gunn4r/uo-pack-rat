// slot-groups.test.mts — `app/vault-lib.mts`'s gear slot groups (issue #218) and the one neck-armor rule.
//
// `app/vault-lib.mts`'s gear slot groups (issue #218): `GEAR_SLOT_GROUPS` gives every slot in `GEAR_SLOTS` exactly one group in the display order, `SLOT_GROUP` and `SLOTS_IN_GROUP` agree with it (neck under Armor, feet and the kilt under Clothing), `REQUIRED_SLOTS` is the Armor group less the neck (which ties the optimizer core's copies, checked in `app/solver.test.mts`, to the table), and one neck-armor rule (`isNeckArmor`, `NECK_ARMOR_WORDS`) serves meditation and Organize's **Armor: neck** preset. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GEAR_SLOTS, GEAR_SLOT_GROUPS, SLOT_GROUP, SLOTS_IN_GROUP, REQUIRED_SLOTS, NECK_ARMOR_WORDS, isNeckArmor } from "./vault-lib.mts";
import { PRESETS } from "./organize-presets.mts";

test("[fast] slot groups: every gear slot has exactly one group, in the four groups' display order", () => {
  const listed = GEAR_SLOT_GROUPS.flatMap(([, slots]) => slots);
  assert.deepEqual([...listed].sort(), [...GEAR_SLOTS].sort());
  assert.equal(new Set(listed).size, listed.length, "no slot is in two groups");
  assert.deepEqual(GEAR_SLOT_GROUPS.map(([g]) => g), ["Armor", "Weapons", "Clothing", "Jewelry"]);
  for (const s of GEAR_SLOTS) assert.ok(SLOTS_IN_GROUP[SLOT_GROUP[s]!].includes(s), `${s} is in its own group's list`);
  assert.equal(SLOT_GROUP.neck, "Armor");
  assert.equal(SLOT_GROUP.feet, "Clothing");
  assert.equal(SLOT_GROUP.outerLegs, "Clothing");
});

// The optimizer core keeps its own copies (it is pasted without imports); app/solver.test.mts checks them against
// GEAR_SLOTS and REQUIRED_SLOTS, and this ties REQUIRED_SLOTS to the Armor group.
test("[fast] slot groups: the slots a search keeps filled are the Armor group less the neck", () => {
  assert.deepEqual(REQUIRED_SLOTS, SLOTS_IN_GROUP.Armor.filter((s) => s !== "neck"));
});

test("[fast] slot groups: one neck-armor rule, for meditation and Organize's Armor: neck preset", () => {
  for (const n of ["Platemail Gorget", "Bone Mempo", "Leather Collar", "Armor Of Initiation", "Studded Armour"]) assert.ok(isNeckArmor(n), n);
  for (const n of ["Gold Necklace", "Gold Beads", "Amulet Of Power"]) assert.ok(!isNeckArmor(n), n);
  assert.deepEqual(PRESETS.find((p) => p.id === "armour-neck")?.match.names, [...NECK_ARMOR_WORDS]);
});
