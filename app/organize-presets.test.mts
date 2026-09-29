// organize-presets.test.mts — app/organize-presets.mts (issue #11): every preset is a valid rule filter, a rule
// copied from one is its own, and the reagent, power scroll and rarity presets find what their names promise.
// Tags: [fast]. Run: node --test app/organize-presets.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules } from "./vault-lib.mts";
import { houseScan, type ThingSpec } from "./organize-fixture.mts";
import { checkOrganizeConfig, emptyOrganizeConfig } from "./organize-config.mts";
import { PRESETS, ruleFromPreset } from "./organize-presets.mts";
import { ruleMatches } from "./organize.mts";
import type { RulesV1 } from "./schema/types.d.mts";

const RULES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rules", "uoalive.json"), "utf8")) as RulesV1;
setRules(RULES);
const CHEST = 0x40000001;
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;
function matching(id: string, names: (string | Omit<ThingSpec, "serial" | "in">)[]): string[] {
  const things = names.map((n, i) => ({ serial: 0x40001000 + i, in: CHEST, ...(typeof n === "string" ? { name: n } : n) }));
  const inv = foldSnapshots([houseScan({ boxes: [{ serial: CHEST }], things })]);
  return Object.values(inv.items).filter((it) => it.kind !== "container" && ruleMatches(it, preset(id).match, RULES.rarity)).map((it) => it.name).sort();
}

test("[fast] every preset makes a valid rule, and preset ids are unique", () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const r = checkOrganizeConfig({ ...emptyOrganizeConfig(), rules: PRESETS.map((p, i) => ruleFromPreset(p, `p${i}`)) });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
});

test("[fast] a rule copied from a preset can be edited without changing the preset", () => {
  const r = ruleFromPreset(preset("magery-reagents"), "mine");
  assert.deepEqual([r.id, r.name, r.targets, r.origin], ["mine", "Magery reagents", [], "manual"]);
  r.match.names!.push("mandrake");
  r.match.query.kind.push("gem");
  assert.equal(preset("magery-reagents").match.names!.includes("mandrake"), false);
  assert.deepEqual(preset("magery-reagents").match.query.kind, ["reagent"]);
});

test("[fast] each reagent preset finds its school's reagents, and Bone Armor is never a Mysticism reagent", () => {
  const all = ["Black Pearl", "Bloodmoss", "Garlic", "Ginseng", "Mandrake Root", "Nightshade", "Spiders' Silk", "Sulfurous Ash",
    "Bat Wing", "Grave Dust", "Daemon Blood", "Nox Crystal", "Pig Iron", "Bone", "Daemon Bone", "Dragon's Blood", "Fertile Dirt",
    { name: "Bone Armor", lines: ["Physical Resist 3%"] }];
  assert.deepEqual(matching("magery-reagents", all), ["Black Pearl", "Bloodmoss", "Garlic", "Ginseng", "Mandrake Root", "Nightshade", "Spiders' Silk", "Sulfurous Ash"]);
  assert.deepEqual(matching("necromancy-reagents", all), ["Bat Wing", "Daemon Blood", "Grave Dust", "Nox Crystal", "Pig Iron"]);
  assert.deepEqual(matching("mysticism-reagents", all), ["Bone", "Daemon Bone", "Dragon's Blood", "Fertile Dirt"]);
});

test("[fast] each power scroll preset finds only its own level", () => {
  const scrolls = [105, 110, 115, 120].map((n) => `A Wondrous Scroll Of Magery (${n} Skill)`);
  for (const n of [105, 110, 115, 120]) assert.deepEqual(matching(`power-scrolls-${n}`, scrolls), [`A Wondrous Scroll Of Magery (${n} Skill)`]);
});

test("[fast] rarity presets: a tier exactly, or gear at Lesser Artifact and below", () => {
  const things = [{ name: "Plate Helm", lines: ["Legendary Artifact", "Physical Resist 5%"] }, { name: "Leather Cap", lines: ["Physical Resist 2%"] }, "Ruby"];
  assert.deepEqual(matching("legendary-artifacts", things), ["Plate Helm"]);
  assert.deepEqual(matching("lesser-artifacts-and-below", things), ["Leather Cap"]);
});
