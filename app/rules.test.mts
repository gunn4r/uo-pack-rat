// rules.test.mts — tests for rules.mts (loadRules/listRules): schema validation, the builtin shards,
// user-directory overrides, and error naming. Tags are name prefixes: [smoke] [fast] [slow].
// Run: node --test app/rules.test.mts   or   node app/rules.test.mts
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
