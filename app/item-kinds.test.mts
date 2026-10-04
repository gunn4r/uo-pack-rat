// item-kinds.test.mts — the player's own item kinds (issue #150): vault-lib.mts's layering over the shipped table as
// the fold enriches each item (a name beats a graphic beats the table, names compare case-insensitively, gear never
// changes), and app/item-kinds.mts's reading of item-kinds.json (salvage), merge and reset. The routes are in
// app/organize-server.test.mts. Tags: [fast]. Run: node --test app/item-kinds.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { foldSnapshots, setRules, overriddenKind, NO_KIND_OVERRIDES, type KindOverrides } from "./vault-lib.mts";
import { salvageKindOverrides, withKinds, withoutKinds, kindsFor, emptyKindOverrides, KIND_LIMITS } from "./item-kinds.mts";
import { houseScan } from "./organize-fixture.mts";
import type { RulesV1 } from "./schema/types.d.mts";

setRules(JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as RulesV1);

const CHEST = 0x40000001, WEAPON = 0x40001001, FRAME = 0x40001002, HORSE = 0x40001003, SWORD = 0x40001004, PEARL = 0x40001005;
const scan = houseScan({ boxes: [{ serial: CHEST }], things: [
  { serial: WEAPON, name: "Ancient Weapon", in: CHEST, graphic: 0x1f14 },
  { serial: FRAME, name: "Clock Frame", in: CHEST, graphic: 0x104e },
  { serial: HORSE, name: "Ethereal Horse Statuette", in: CHEST, graphic: 0x1f14 },
  { serial: SWORD, name: "Katana", in: CHEST, graphic: 0x13ff, lines: ["Katana", "Damage Increase 10%"] },
  { serial: PEARL, name: "Black Pearl", in: CHEST, amount: 20, graphic: 0x0f7a },
] });
const kinds = (o?: KindOverrides): Record<number, string | undefined> => {
  const items = foldSnapshots([scan], o).items;
  return Object.fromEntries([WEAPON, FRAME, HORSE, SWORD, PEARL].map((s) => [s, items[s]?.kind]));
};

test("[fast] item kinds: a Scroll of Transcendence takes its display name's kind, then its in-game name's, then its graphic's (issue #181)", () => {
  const SOT = 0x40001006;
  const sotScan = houseScan({ boxes: [{ serial: CHEST }], things: [{ serial: SOT, name: "Scroll Of Transcendence", in: CHEST, graphic: 0x14ef, lines: ["Scroll Of Transcendence", "Skill: Chivalry 0.6 Skill Points"] }] });
  const kind = (o: KindOverrides): string | undefined => foldSnapshots([sotScan], o).items[SOT]?.kind;
  assert.equal(kind({ names: { "scroll of transcendence": "quest" }, graphics: {} }), "quest", "an override made before the display name still applies");
  assert.equal(kind({ names: { "scroll of transcendence": "quest", "scroll of transcendence (chivalry - 0.6 pts)": "decor" }, graphics: { "0x14ef": "tool" } }), "decor");
  assert.equal(kind({ names: {}, graphics: { "0x14ef": "tool" } }), "tool");
});

test("[fast] item kinds: the shipped table alone, then a name beats a graphic beats the table, and gear never changes", () => {
  assert.deepEqual(kinds(), { [WEAPON]: "other", [FRAME]: "resource", [HORSE]: "decor", [SWORD]: "gear", [PEARL]: "reagent" });
  const o: KindOverrides = { names: { "ancient weapon": "quest", "katana": "decor", "black pearl": "tool" }, graphics: { "0x1f14": "crafting", "0x13ff": "tool", "0x104e": "decor" } };
  assert.deepEqual(kinds(o), { [WEAPON]: "quest", [FRAME]: "decor", [HORSE]: "crafting", [SWORD]: "gear", [PEARL]: "tool" },
    "the name wins for the Ancient Weapon, the graphic over the table for the statuette and the frame, the Katana stays gear, a stack by its name");
});

test("[fast] item kinds: a name compares trimmed and case-insensitively, and an inherited key is never an override", () => {
  assert.equal(overriddenKind({ names: { "clock frame": "decor" }, graphics: {} }, "  CLOCK Frame ", null), "decor");
  assert.equal(overriddenKind(NO_KIND_OVERRIDES, "constructor", 0), null);
  assert.equal(overriddenKind(NO_KIND_OVERRIDES, "__proto__", null), null);
  assert.equal(overriddenKind({ names: {}, graphics: { "0x1f14": "decor" } }, "Anything", 0x1F14), "decor");
});

test("[fast] salvageKindOverrides keeps what makes sense, normalises keys and names each entry it left out", () => {
  const { overrides, problems } = salvageKindOverrides({ version: 1,
    names: { " Clock FRAME ": "decor", "": "tool", "Katana": "gear", "Rock": "boulder", "Odd": 3, "Wooden Box": "container", "Bell\u0007": "decor", ["x".repeat(300)]: "tool", ...JSON.parse('{"__proto__": "quest"}') },
    graphics: { "0x1F14": "crafting", "7956": "tool", "0x12345": "tool" } });
  assert.deepEqual(Object.entries(overrides.names), [["clock frame", "decor"], ["__proto__", "quest"]]);
  assert.deepEqual(overrides.graphics, { "0x1f14": "crafting" });
  assert.equal(problems.length, 9, problems.join(" | "));
  assert.match(problems.join(" | "), /"Katana": "gear" is not a kind/);
  assert.match(problems.join(" | "), /"Wooden Box": "container" is not a kind/, "Organize never moves a container, so it is no one's pick");
  assert.match(problems.join(" | "), /names "Bell\\u0007" is not an item name/);
  assert.match(problems.join(" | "), /graphics "7956" is not a graphic/);
});

test("[fast] salvageKindOverrides reads nothing from a document that is not a version 1 object, and caps the entries", () => {
  for (const raw of [null, [], "names", 7, { version: 2, names: { a: "decor" } }]) {
    const r = salvageKindOverrides(raw);
    assert.deepEqual(r.overrides, emptyKindOverrides());
    assert.equal(r.problems.length, 1);
  }
  assert.deepEqual(salvageKindOverrides({ names: "decor" }), { overrides: emptyKindOverrides(), problems: ["names is not an object"] });
  const many = Object.fromEntries(Array.from({ length: KIND_LIMITS.entries + 3 }, (_, i) => [`item ${i}`, "decor"]));
  const capped = salvageKindOverrides({ names: many });
  assert.equal(Object.keys(capped.overrides.names).length, KIND_LIMITS.entries);
  assert.match(capped.problems.at(-1)!, /more than 5000 entries/);
});

test("[fast] withKinds merges with the added entries winning and refuses to pass the cap; withoutKinds resets one item", () => {
  const base: KindOverrides = { names: { "clock frame": "decor", "springs": "tool" }, graphics: { "0x1f14": "decor" } };
  assert.deepEqual(withKinds(base, { names: { "clock frame": "resource", "rug": "decor" }, graphics: {} }),
    { names: { "clock frame": "resource", "springs": "tool", "rug": "decor" }, graphics: { "0x1f14": "decor" } });
  assert.deepEqual(kindsFor({ name: " Clock Frame", graphic: 0x1F14 }, "quest"), { names: { "clock frame": "quest" }, graphics: { "0x1f14": "quest" } });
  const full = { names: Object.fromEntries(Array.from({ length: KIND_LIMITS.entries }, (_, i) => [`item ${i}`, "decor"])), graphics: {} };
  assert.equal(withKinds(full, kindsFor({ name: "one more" }, "decor")), null);
  assert.ok(withKinds(full, kindsFor({ name: "item 0" }, "tool")), "changing an entry already there is not one more");
  assert.deepEqual(withoutKinds(base, { name: "CLOCK FRAME" }), { names: { "springs": "tool" }, graphics: { "0x1f14": "decor" } });
  assert.deepEqual(withoutKinds(base, { graphic: 0x1f14 }), { names: base.names, graphics: {} });
});
