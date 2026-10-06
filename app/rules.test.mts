// rules.test.mts — `app/rules.mts` (`loadRules`, `listRules`): schema validation, the builtin shards, user-folder overrides and error naming.
//
// `app/rules.mts`: both builtin rules files (`uoalive`, `generic-osi`) load and validate against `app/schema/rules.v1.schema.json`; `DEFAULT_SHARD`; `listRules` enumerates both builtins; a user rules file in a `userRulesDir` overrides a builtin of the same `id` (by the file's own `id` field, not its filename) and is reported with `source: "user"`; an invalid user rules file throws naming the file's path, including one whose caps, race caps, tag units or breakpoints are not numbers; the optional `scrollBinder` (issue #181): uoalive's power scroll, stat scroll and Transcendence recipes, none in generic-osi, each list optional, and a step with a non-integer or too-small count, an unknown key, a step down, two steps from one level, or usable Transcendence totals out of order, finer than a tenth, empty or zero all refused naming the file; `loadRules` throws naming the shard id when no matching file exists anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRules, listRules, DEFAULT_SHARD } from "./rules.mts";

test("[smoke] loadRules(\"uoalive\") validates and carries all 19 property caps", () => {
  const r = loadRules("uoalive");
  assert.equal(r.id, "uoalive");
  assert.equal(Object.keys(r.caps).length, 19);
  assert.equal(r.caps.physResist, 70);
  assert.deepEqual(r.resistSkillBonus.breakpoints, [[100, 0.4], [120, 0.2]]);
  // raceCaps is Record<string, unknown> in the generated RulesV1 type (the schema doesn't reify a
  // per-race shape) — cast to read the nested field this rules file actually carries.
  assert.equal((r.raceCaps.elf as Record<string, unknown>).energyResist, 75);
  assert.equal(r.raceLock.gargoyleOnly, true);
});

test("[smoke] loadRules(\"generic-osi\") validates, no flat Resisting Spells bonus, no massive/unwieldy tag units", () => {
  const r = loadRules("generic-osi");
  assert.equal(r.id, "generic-osi");
  assert.deepEqual(r.resistSkillBonus.breakpoints, []);
  assert.ok(!("massive" in r.tagUnits) && !("unwieldy" in r.tagUnits));
  assert.deepEqual(r.freeSkills, []);
});

test("[smoke] loadRules throws naming the shard id when no such file exists", () => {
  assert.throws(() => loadRules("nope"), /nope/);
});

test("[fast] DEFAULT_SHARD is uoalive", () => {
  assert.equal(DEFAULT_SHARD, "uoalive");
});

test("[fast] listRules returns both builtins", () => {
  const rules = listRules();
  const ids = rules.map((r) => r.id).sort();
  assert.ok(ids.includes("uoalive"));
  assert.ok(ids.includes("generic-osi"));
  assert.ok(rules.every((r) => r.source === "builtin"));
});

test("[fast] a user rules dir overrides a builtin of the same id and appears with source \"user\"", () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rules-"));
  writeFileSync(join(dir, "custom.json"), JSON.stringify({
    schemaVersion: 1, id: "uoalive", name: "UO Alive (custom)",
    caps: { physResist: 70 }, raceCaps: {}, resistSkillBonus: { breakpoints: [] },
    tagUnits: {}, rarity: [], raceLock: { gargoyleOnly: true }, freeSkills: [],
  }));
  const rules = listRules({ userRulesDir: dir });
  const uoalive = rules.find((r) => r.id === "uoalive");
  assert.equal(uoalive!.source, "user");
  assert.equal(uoalive!.name, "UO Alive (custom)");
  // A second user file also carrying id "uoalive" — files are read in sorted filename order, so
  // "uoalive.json" (sorts after "custom.json") is the one loadRules() resolves to here. The point
  // being tested is NOT "the filename matching the id wins" (that was the pre-fix, buggy rule) — see
  // the dedicated mismatched-filename test below for that.
  writeFileSync(join(dir, "uoalive.json"), JSON.stringify({
    schemaVersion: 1, id: "uoalive", name: "UO Alive (user file)",
    caps: { physResist: 65 }, raceCaps: {}, resistSkillBonus: { breakpoints: [] },
    tagUnits: {}, rarity: [], raceLock: { gargoyleOnly: true }, freeSkills: [],
  }));
  const r = loadRules("uoalive", { userRulesDir: dir });
  assert.equal(r.name, "UO Alive (user file)");
  assert.equal(r.caps.physResist, 65);
});

// Finding 1: listRules() used to key a user file by its own `id` field while loadRules() resolved by
// FILENAME `<id>.json` — a user file named anything else was listed (and offered by the picker) but
// could never actually be loaded. loadRules() now resolves THROUGH listRules()'s own {id → path}
// map, so a file's name is irrelevant to whether it can be loaded.
test("[fast] a user rules file whose filename does NOT match its id lists AND loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rules-"));
  writeFileSync(join(dir, "my-shard-file.json"), JSON.stringify({
    schemaVersion: 1, id: "myshard", name: "My Shard",
    caps: { physResist: 70 }, raceCaps: {}, resistSkillBonus: { breakpoints: [] },
    tagUnits: {}, rarity: [], raceLock: { gargoyleOnly: false }, freeSkills: [],
  }));
  const listed = listRules({ userRulesDir: dir });
  const entry = listed.find((r) => r.id === "myshard");
  assert.ok(entry, JSON.stringify(listed));
  assert.equal(entry.source, "user");
  assert.equal(entry.path, join(dir, "my-shard-file.json"));
  const r = loadRules("myshard", { userRulesDir: dir });
  assert.equal(r.id, "myshard");
  assert.equal(r.name, "My Shard");
});

test("[fast] an invalid user rules file throws naming the file path", () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rules-bad-"));
  const path = join(dir, "broken.json");
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, id: "broken" }));   // missing every other required key
  assert.throws(() => loadRules("broken", { userRulesDir: dir }), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// The rules schema used to check shapes only, so a string cap or a one-element breakpoint passed
// validation and turned into NaN caps and string tag penalties downstream.
test("[fast] a user rules file with non-numeric caps, tag units or breakpoints is rejected", () => {
  const good = loadRules("uoalive");
  const bad: Array<[string, Record<string, unknown>]> = [
    ["caps", { caps: { ...good.caps, fc: "two" } }],
    ["raceCaps", { raceCaps: { elf: { energyResist: "75" } } }],
    ["tagUnits", { tagUnits: { ...good.tagUnits, cursed: "10" } }],
    ["one-element breakpoint", { resistSkillBonus: { breakpoints: [[100]] } }],
    ["three-element breakpoint", { resistSkillBonus: { breakpoints: [[100, 0.4, 1]] } }],
    ["string breakpoint", { resistSkillBonus: { breakpoints: [["100", 0.4]] } }],
  ];
  for (const [what, patch] of bad) {
    const dir = mkdtempSync(join(tmpdir(), "qm-rules-values-"));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...good, id: "bad", ...patch }));
    assert.throws(() => loadRules("bad", { userRulesDir: dir }), /bad\.json/, what);
  }
});

// tagInfo (a tag's meaning, shown on hover in the item peek) is optional; when present every value is a
// non-empty string of at most 400 characters.
test("[fast] tagInfo is optional and must map tags to short text", () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rules-"));
  const base = { schemaVersion: 1, name: "Tag shard", caps: {}, raceCaps: {}, resistSkillBonus: { breakpoints: [] }, tagUnits: { cursed: 1 }, rarity: [], raceLock: { gargoyleOnly: true }, freeSkills: [] };
  writeFileSync(join(dir, "ok.json"), JSON.stringify({ ...base, id: "tagok", tagInfo: { cursed: "Drops on death." } }));
  assert.equal(loadRules("tagok", { userRulesDir: dir }).tagInfo?.cursed, "Drops on death.");
  for (const [i, bad] of [{ cursed: 5 }, { cursed: "" }, { cursed: "x".repeat(401) }].entries()) {
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...base, id: `tagbad${i}`, tagInfo: bad }));
    assert.throws(() => loadRules(`tagbad${i}`, { userRulesDir: dir }), `${JSON.stringify(bad).slice(0, 40)} should be refused`);
  }
});

// scrollBinder (issue #181): the Scroll Binder's recipes, which the Inventory's Scrolls view rolls up against. Optional:
// a shard without it gets the view's plain holdings.
test("[fast] uoalive carries the Scroll Binder recipes and generic-osi none", () => {
  const sb = loadRules("uoalive").scrollBinder;
  assert.deepEqual(sb?.powerScrolls, [{ from: 105, to: 110, count: 8 }, { from: 110, to: 115, count: 12 }, { from: 115, to: 120, count: 10 }]);
  assert.deepEqual(sb?.statScrolls, [{ from: 5, to: 10, count: 6 }, { from: 10, to: 15, count: 8 }, { from: 15, to: 20, count: 8 }, { from: 20, to: 25, count: 5 }]);
  assert.deepEqual(sb?.transcendence, { usableAt: [2, 5] });
  assert.equal(loadRules("generic-osi").scrollBinder, undefined);
});

test("[fast] a scrollBinder that could not be rolled up is refused", () => {
  const good = loadRules("uoalive");
  const step = { from: 105, to: 110, count: 8 };
  const bad: Array<[string, unknown]> = [
    ["a string count", { powerScrolls: [{ ...step, count: "8" }] }],
    ["a count of 1", { powerScrolls: [{ ...step, count: 1 }] }],
    ["a fractional level", { powerScrolls: [{ ...step, from: 105.5 }] }],
    ["a step missing its target", { powerScrolls: [{ from: 105, count: 8 }] }],
    ["an unknown key", { powerScrolls: [step], extra: true }],
    ["a step down", { powerScrolls: [{ from: 110, to: 105, count: 8 }] }],
    ["two steps from one level", { powerScrolls: [step, { from: 105, to: 115, count: 20 }] }],
    ["usable points out of order", { transcendence: { usableAt: [5, 2] } }],
    ["usable points finer than a tenth", { transcendence: { usableAt: [2.05] } }],
    ["no usable points", { transcendence: { usableAt: [] } }],
    ["zero usable points", { transcendence: { usableAt: [0, 2] } }],
  ];
  for (const [what, scrollBinder] of bad) {
    const dir = mkdtempSync(join(tmpdir(), "qm-rules-binder-"));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...good, id: "bad", scrollBinder }));
    assert.throws(() => loadRules("bad", { userRulesDir: dir }), /bad\.json/, what);
  }
  const dir = mkdtempSync(join(tmpdir(), "qm-rules-binder-"));
  writeFileSync(join(dir, "ok.json"), JSON.stringify({ ...good, id: "partial", scrollBinder: { transcendence: { usableAt: [1.5] } } }));
  assert.deepEqual(loadRules("partial", { userRulesDir: dir }).scrollBinder, { transcendence: { usableAt: [1.5] } }, "each recipe list is optional");
});

// slayerGroups (issue #189): the Slayer filter's super slayers with their lesser slayers, as the shard's wiki charts
// them. Optional: a shard without it gets the plain A–Z list.
test("[fast] uoalive groups its slayers like the wiki's charts, generic-osi like ServUO's SlayerGroup", () => {
  const ua = loadRules("uoalive").slayerGroups ?? [];
  const lesserOf = (groups: typeof ua, superName: string) => groups.find((g) => g.super?.includes(superName))?.slayers;
  assert.deepEqual(lesserOf(ua, "Reptile"), ["Dragon", "Lizardman", "Ophidian", "Snake"]);
  assert.deepEqual(lesserOf(ua, "Repond"), ["Goblin", "Orc", "Ogre", "Troll", "Vermin"], "the wiki's chart puts Goblin and Vermin under Repond");
  assert.deepEqual(lesserOf(ua, "Fey"), []);
  assert.ok(ua.find((g) => g.heading === "Talisman slayers")?.slayers.includes("Mage"));
  const go = loadRules("generic-osi").slayerGroups ?? [];
  assert.deepEqual(lesserOf(go, "Repond"), ["Ogre", "Orc", "Troll"], "stock ServUO has Goblin as a talisman slayer");
  assert.ok(go.find((g) => g.heading === "Talisman slayers")?.slayers.includes("Goblin"));
});

test("[fast] a slayerGroups table that could not be drawn is refused", () => {
  const good = loadRules("uoalive");
  const bad: Array<[string, unknown]> = [
    ["not a list", { Reptile: ["Dragon"] }],
    ["a group without slayers", [{ super: ["Reptile"] }]],
    ["a super that is not a list", [{ super: "Reptile", slayers: [] }]],
    ["an empty name", [{ super: ["Reptile"], slayers: [""] }]],
    ["an unknown key", [{ super: ["Reptile"], slayers: [], lesser: [] }]],
    ["neither a super nor a heading", [{ slayers: ["Dragon"] }]],
    ["both a super and a heading", [{ super: ["Reptile"], heading: "Reptiles", slayers: [] }]],
    ["a name in two places", [{ super: ["Reptile"], slayers: ["Dragon"] }, { heading: "Talisman slayers", slayers: ["dragon"] }]],
  ];
  for (const [what, slayerGroups] of bad) {
    const dir = mkdtempSync(join(tmpdir(), "qm-rules-slayers-"));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...good, id: "bad", slayerGroups }));
    assert.throws(() => loadRules("bad", { userRulesDir: dir }), /bad\.json/, what);
  }
});
