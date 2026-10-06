// run-settings.test.mts — app/run-settings.mts, the one check a run's settings are held to: a snapshot built the way the
// page's settingsSnapshot and build_suit build theirs passes (search fields left wrong without exact search included),
// one refused field per kind with the label in the reason, a null field skipped, and the defaults' STR limit. Also the
// saved-run document (runs-lib.mts runRecord): each writer's file lists its fields in the order it always has.
// Tags: [fast]. Run: node --test app/run-settings.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setRules } from "./vault-lib.mts";
import { BUFFS, buffSkillValues, runBuffs } from "./buffs.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { DEFAULT_STR_LIMIT, RUN_DEFAULTS, defaultStrLimit, runSettingsError } from "./run-settings.mts";
import { firstKnobError, type Knobs } from "./ui/builder-model.mts";
import { runRecord, SOLVER_VERSION } from "./runs-lib.mts";

setRules(JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as RulesV1);

// A panel profile as the page holds it (state.builder.profile after readControls).
const profile = {
  floors: { hci: 45, "sk:Magery": 20 }, softFloors: ["hci"], weights: { dci: 2.5, ssi: -1 }, lockedSlots: ["twoHanded"], excludeTags: ["Cursed"],
  excludeRoots: [0x40001234, "bank"], strLimit: 95, allowGargoyle: false, medOnly: true, excludeWeapons: ["archery"], ubwsAnyWeapon: true,
  allowOthersWorn: false, race: "elf", excludeSkills: ["Necromancy"], resistCaps: { fireResist: 75 },
};
// ui/runs.mts settingsSnapshot, the same expression over a profile and the Advanced fields.
function pageSnapshot(p: typeof profile, knobs: Knobs): Record<string, unknown> {
  return { floors: { ...(p.floors || {}) }, softFloors: [...(p.softFloors || [])], weights: { ...(p.weights || {}) }, lockedSlots: [...(p.lockedSlots || [])],
    excludeTags: [...(p.excludeTags || [])], excludeRoots: [...(p.excludeRoots || [])], strLimit: p.strLimit, allowGargoyle: !!p.allowGargoyle,
    medOnly: !!p.medOnly, excludeWeapons: [...(p.excludeWeapons || [])], ubwsAnyWeapon: p.ubwsAnyWeapon !== false, allowOthersWorn: !!p.allowOthersWorn,
    restarts: Number(knobs.restarts) || RUN_DEFAULTS.restarts, exact: knobs.exact, budgetMs: 1000 * Number(knobs.budgetS) || RUN_DEFAULTS.budgetMs,
    altCount: Number(knobs.altCount) || 0, altTol: Number(knobs.altTol) || 0, race: p.race || "human", excludeSkills: [...(p.excludeSkills || [])], resistCaps: { ...(p.resistCaps || {}) },
    buffs: runBuffs([BUFFS[0]!.id], buffSkillValues(null, {}).values) };
}

test("[fast] run settings: the page's settings snapshot passes", () => {
  const knobs: Knobs = { strLimit: "95", restarts: "200", exact: true, budgetS: "300", altCount: "5", altTol: "40" };
  assert.equal(firstKnobError(knobs), null, "the page would build with these");
  assert.equal(runSettingsError(pageSnapshot(profile, knobs), "meta.settings"), null);
  // Without exact search the page leaves the budget and other-suits fields unchecked (they are disabled), so the snapshot
  // can carry anything typed there before exact search was turned off.
  const off: Knobs = { ...knobs, exact: false, budgetS: "99999", altCount: "500", altTol: "-3" };
  assert.equal(firstKnobError(off), null, "the page would build with these too");
  assert.equal(runSettingsError(pageSnapshot(profile, off), "meta.settings"), null);
  // …and the pool settings it sends beside it (ui/builder.mts poolSettings)
  const { allowOthersWorn, strLimit, excludeTags, excludeRoots, allowGargoyle, medOnly, excludeWeapons, ubwsAnyWeapon, excludeSkills, lockedSlots } = profile;
  assert.equal(runSettingsError({ allowOthersWorn, strLimit, excludeTags, excludeRoots, allowGargoyle, medOnly, excludeWeapons, ubwsAnyWeapon, excludeSkills, lockedSlots }, "settings"), null);
});

test("[fast] run settings: build_suit's settings and snapshot pass", () => {
  // app/mcp-tools.mts planProfile and build_suit, for a character with no saved profile and a scanned STR
  const settings = { allowOthersWorn: false, strLimit: defaultStrLimit({ stats: { str: 110 } }), excludeTags: [], excludeRoots: [], allowGargoyle: false, medOnly: false,
    excludeWeapons: [], ubwsAnyWeapon: true, excludeSkills: [], lockedSlots: [] };
  const snapshot = { ...settings, floors: {}, softFloors: [], weights: {}, race: "human", resistCaps: {}, restarts: RUN_DEFAULTS.restarts, exact: true, budgetMs: RUN_DEFAULTS.mcpBudgetMs, altCount: 20, altTol: 0 };
  assert.equal(runSettingsError(settings, "settings"), null);
  assert.equal(runSettingsError(snapshot, "meta.settings"), null);
});

test("[fast] run settings: one refused field of each kind, named with its label", () => {
  const refused: Array<[unknown, string | null]> = [   // null: the field's own rule words the reason
    ["nope", "meta.settings must be an object"],
    [{ floors: { hci: 1e7 } }, "meta.settings.floors.hci must be a number between -1000000 and 1000000"],
    [{ medOnly: "yes" }, "meta.settings.medOnly must be a boolean"],
    [{ strLimit: 0 }, "meta.settings.strLimit must be a whole number from 1 to 1000"],
    [{ altTol: -1 }, "meta.settings.altTol must be a number of 0 or more"],
    [{ budgetMs: 1e12, exact: true }, "meta.settings.budgetMs must be a whole number from 0 to 3600000"],
    [{ budgetMs: "300", exact: false }, "meta.settings.budgetMs must be a whole number from 0 to 3600000"],
    [{ excludeTags: [5] }, "meta.settings.excludeTags must be a list of names"],
    [{ race: "orc" }, "meta.settings.race must be human, elf or gargoyle"],
    [{ excludeWeapons: ["bows"] }, null],
    [{ resistCaps: { fireResist: 900 } }, null],
    [{ buffs: { on: ["noSuchBuff"], skills: {} } }, "meta.settings.buffs must list known buffs, each once and one form at most, with their numbers in range"],
    [{ template: "melee" }, "meta.settings.template is not a run setting"],
  ];
  for (const [settings, reason] of refused) {
    const e = runSettingsError(settings, "meta.settings");
    assert.ok(e, JSON.stringify(settings));
    if (reason) assert.equal(e, reason);
    else assert.ok(e.startsWith("meta.settings."), e);
  }
  assert.equal(runSettingsError({ excludeTags: [5] }, "settings"), "settings.excludeTags must be a list of names", "the label is the caller's");
});

test("[fast] run settings: a null field means the default, and so does no settings at all", () => {
  assert.equal(runSettingsError({ strLimit: null, excludeTags: null, race: null }, "settings"), null);
  assert.equal(runSettingsError(undefined, "settings"), null);
  assert.equal(runSettingsError(null, "settings"), null);
});

test("[fast] run settings: the default STR limit is the character's STR, else 125", () => {
  assert.equal(defaultStrLimit({ stats: { str: 88 } }), 88);
  assert.equal(defaultStrLimit({ stats: {} }), DEFAULT_STR_LIMIT);
  assert.equal(defaultStrLimit(null), DEFAULT_STR_LIMIT);
});

test("[fast] saved runs: a search's file and a manual run's keep their own field order", () => {
  const base = { id: "r1", key: "k", character: "A", createdAt: "2026-10-06T00:00:00Z", settings: { floors: { hci: 1 } }, inventoryStamp: "s", poolSize: 12, skipped: { str: 1 }, ms: 40, result: { method: "exact" } };
  const search = runRecord({ ...base, search: { opts: { restarts: 200 }, budgetMs: 300000, explored: 7 } });
  // the jobs service's saveRun before runRecord, field for field
  assert.equal(JSON.stringify(search), JSON.stringify({ id: "r1", key: "k", character: "A", createdAt: base.createdAt, label: "", schemaVersion: 1, solverVersion: SOLVER_VERSION,
    settings: base.settings, inventoryStamp: "s", poolSize: 12, skipped: { str: 1 }, opts: { restarts: 200 }, budgetMs: 300000, explored: 7, result: base.result, ms: 40 }));
  const manual = runRecord({ ...base, poolSize: null, skipped: {}, ms: 0 });
  // manualRun before runRecord
  assert.equal(JSON.stringify(manual), JSON.stringify({ id: "r1", key: "k", character: "A", createdAt: base.createdAt, label: "", settings: base.settings, schemaVersion: 1,
    solverVersion: SOLVER_VERSION, inventoryStamp: "s", poolSize: null, skipped: {}, ms: 0, result: base.result }));
});
