// build-spec.test.mts — `app/build-spec.mts`, a build's intent as one document (issue #218, BuildSpec).
//
// `[fast]`: `app/build-spec.mts`: a full spec, a template's (no buffs) and one filled from nothing pass `buildSpecError`, and one refused field of each kind says where; the panel's flat profile goes to a spec and back unchanged; and `planBuild` equals the assemblies it replaced, kept in the test as they were written: the page's build (its profile, pool settings, search options and saved-run snapshot, ui/builder.mts and ui/runs.mts) and the MCP tools' `planProfile` (mcp-tools.mts), for the demo characters with and without buffs and edited numbers, No character, and a hand-picked suit planned as Manual plans it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, migrateProfiles, setRules, templateFrom, type CharacterEntryRaw, type Character, type Item, type Profile, type ProfilesFile } from "./vault-lib.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { upgradeScan } from "./scan-schema.mts";
import { buffPlanOf, buffSkillValues, manualBase, manualPlan, plannedProfile, runBuffs } from "./buffs.mts";
import { RACES, RUN_DEFAULTS, defaultStrLimit } from "./run-settings.mts";
import { buildSpec, buildSpecError, type BuildSpecSource, type CharacterEntry, characterBuffs, characterProfile, findTemplate, migrateProfilesV3, planBuild, profileFromSpec, profilesSpecError, specFromProfile, templateLabel, templateRefs, templateSettings,
  type BuildSpec, type FlatProfile, type ProfilesV3, type TemplateMap } from "./build-spec.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);
const scan = (n: string): ReturnType<typeof upgradeScan> => upgradeScan(JSON.parse(readFileSync(join(HERE, "fixtures", `demo-${n}.json`), "utf8")), { shard: "test" });
const inv = foldSnapshots([scan("Kestrel"), scan("Dorran")] as Parameters<typeof foldSnapshots>[0]);
const wornBy: Record<string, Item[]> = {};
for (const it of Object.values(inv.items)) if (it.equippedBy) (wornBy[it.equippedBy] ||= []).push(it);
const SKILLS = { "Resisting Spells": 100, Chivalry: 120, Magery: 100, Bushido: 100 };
const withSkills = (c: Character): Character => ({ ...c, skills: Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, { value: v }])) } as Character);

// A panel profile as the page holds it (state.builder.profile after readControls).
const PANEL: FlatProfile = {
  floors: { hci: 45, physResist: 60 }, softFloors: ["hci"], weights: { dci: 2.5, ssi: -1 }, floorBonus: 1000, lockedSlots: ["twoHanded"], excludeTags: ["Cursed"],
  excludeRoots: [0x40001234, "bank"], strLimit: 95, allowGargoyle: false, medOnly: true, excludeWeapons: ["archery"], ubwsAnyWeapon: true,
  allowOthersWorn: false, race: "elf", excludeSkills: ["Necromancy"], resistCaps: { fireResist: 75 }, template: "melee",
};

test("[fast] build spec: a full spec, a template's and an empty one pass; each kind of bad field is refused where it is", () => {
  const spec = specFromProfile(PANEL, { on: ["divineFury"], skills: { Chivalry: 90 } });
  assert.equal(buildSpecError(spec, "spec"), null);
  assert.equal(buildSpecError({ ...spec, goal: { kind: "best", suits: 3 }, search: { budgetMs: 60_000, exact: true, restarts: 50, altCount: 2, altTol: 0 } }, "spec"), null);
  assert.equal(buildSpecError(buildSpec(), "spec"), null, "every default passes");
  const { buffs: _b, ...tpl } = spec;
  assert.equal(buildSpecError(tpl, "t", { template: true }), null, "a template needs no buffs");
  assert.match(buildSpecError(tpl, "c")!, /^c\.buffs must list known buffs/, "a character's spec does");
  assert.equal(buildSpecError({ ...spec, pool: { ...spec.pool, strLimit: "character" } }, "spec"), null);
  const bad: Array<[unknown, RegExp]> = [
    [null, /^spec must be an object$/],
    [{ ...spec, extra: 1 }, /^spec\.extra is not part of a build$/],
    [{ ...spec, intent: { ...spec.intent, race: "elf" } }, /^spec\.intent\.race is not a intent setting$/],
    [{ ...spec, intent: { ...spec.intent, floors: { hci: "45" } } }, /^spec\.intent\.floors\.hci must be a number/],
    [{ ...spec, intent: { ...spec.intent, floorBonus: "x" } }, /^spec\.intent\.floorBonus must be a number/],
    [{ ...spec, intent: { ...spec.intent, resistCaps: { fireResist: 200 } } }, /^spec\.intent\.resistCaps/],
    [{ ...spec, pool: { ...spec.pool, strLimit: 0 } }, /^spec\.pool\.strLimit must be "character" or a whole number from 1 to 1000$/],
    [{ ...spec, pool: { ...spec.pool, strLimit: "mine" } }, /^spec\.pool\.strLimit must be "character"/],
    [{ ...spec, pool: { ...spec.pool, excludeWeapons: ["wrestling"] } }, /^spec\.pool\.excludeWeapons\[0\] is not a weapon skill/],
    [{ ...spec, pool: { ...spec.pool, medOnly: "yes" } }, /^spec\.pool\.medOnly must be a boolean$/],
    [{ ...spec, pool: { ...spec.pool, floors: {} } }, /^spec\.pool\.floors is not a pool setting$/],
    [{ ...spec, buffs: { on: ["noSuchBuff"], skills: {} } }, /^spec\.buffs must list known buffs/],
    [{ ...spec, buffs: { on: [], skills: { Chivalry: 9999 } } }, /^spec\.buffs must list known buffs/],
    [{ ...spec, goal: { kind: "fastest" } }, /^spec\.goal\.kind must be best or cheapest$/],
    [{ ...spec, goal: { kind: "best", suits: 0 } }, /^spec\.goal\.suits must be a whole number from 1 to 100$/],
    [{ ...spec, search: { timeBudgetMs: 5 } }, /^spec\.search\.timeBudgetMs is not a search setting$/],
    [{ ...spec, search: { restarts: 0 } }, /^spec\.search\.restarts must be a whole number from 1 to 10000$/],
  ];
  for (const [v, want] of bad) assert.match(buildSpecError(v, "spec") ?? "passed", want, JSON.stringify(v));
});

test("[fast] build spec: the panel's flat profile goes to a spec and back; absent fields take the defaults", () => {
  const { race: _r, template: _t, ...settings } = PANEL;
  assert.deepEqual(profileFromSpec(specFromProfile(PANEL)), settings);
  assert.deepEqual(profileFromSpec(specFromProfile({ ...PANEL, strLimit: undefined })), (({ strLimit: _s, ...rest }) => rest)(settings), "no STR limit: the character's");
  const empty = buildSpec();
  assert.equal(empty.pool.strLimit, "character");
  assert.equal(empty.pool.ubwsAnyWeapon, true);
  assert.equal(empty.intent.floorBonus, 1000);
  assert.deepEqual(profileFromSpec(empty), { ...templateFrom(), excludeRoots: [] }, "the same defaults templateFrom fills in");
});

// ---- planBuild against the assemblies it replaced
// The page (ui/builder.mts runBuild, optimizerProfile, poolSettings, searchOpts; ui/runs.mts settingsSnapshot), as written.
interface Knobs { strLimit: string; restarts: string; exact: boolean; budgetS: string; altCount: string; altTol: string }
function pageBuild(p: FlatProfile, c: Character, worn: Item[], on: string[], edits: Record<string, number>, knobs: Knobs) {
  const panelBuffs = runBuffs(on, buffSkillValues(c.skills || {}, edits).values);
  const profile = plannedProfile(p, c, buffPlanOf(c, worn, p.race, panelBuffs, edits));
  const settings = { allowOthersWorn: p.allowOthersWorn, strLimit: p.strLimit, excludeTags: p.excludeTags, excludeRoots: p.excludeRoots, allowGargoyle: p.allowGargoyle, medOnly: p.medOnly, excludeWeapons: p.excludeWeapons || [], ubwsAnyWeapon: p.ubwsAnyWeapon !== false, excludeSkills: p.excludeSkills || [], lockedSlots: p.lockedSlots };
  const exact = knobs.exact, altCount = Number(knobs.altCount), altTol = Number(knobs.altTol);
  const opts = { ...{ restarts: Number(knobs.restarts), exact: knobs.exact, ...(knobs.exact ? { timeBudgetMs: 1000 * Number(knobs.budgetS) } : {}) }, ...(exact && altCount > 0 ? { alternatives: { count: altCount, tolerance: altTol } } : {}) };
  const snapshot = { floors: { ...(p.floors || {}) }, softFloors: [...(p.softFloors || [])], weights: { ...(p.weights || {}) }, lockedSlots: [...(p.lockedSlots || [])],
    excludeTags: [...(p.excludeTags || [])], excludeRoots: [...(p.excludeRoots || [])], strLimit: p.strLimit, allowGargoyle: !!p.allowGargoyle,
    medOnly: !!p.medOnly, excludeWeapons: [...(p.excludeWeapons || [])], ubwsAnyWeapon: p.ubwsAnyWeapon !== false, allowOthersWorn: !!p.allowOthersWorn,
    restarts: Number(knobs.restarts) || RUN_DEFAULTS.restarts, exact: knobs.exact, budgetMs: 1000 * Number(knobs.budgetS) || RUN_DEFAULTS.budgetMs,
    altCount: Number(knobs.altCount) || 0, altTol: Number(knobs.altTol) || 0, race: p.race || "human", excludeSkills: [...(p.excludeSkills || [])], resistCaps: { ...(p.resistCaps || {}) }, buffs: panelBuffs };
  return { profile, settings, opts, snapshot };
}
// The MCP tools (mcp-tools.mts planProfile and build_suit's body), as written; `p` is characterProfile's answer.
function mcpBuild(p: FlatProfile, c: Character | null, worn: Item[], on: string[], edits: Record<string, number>, suit: Record<string, Item> | null, budget: number, alt: number) {
  const rb = runBuffs(on, buffSkillValues(c ? c.skills || {} : null, edits).values);
  const base = suit ? manualBase(p as Profile, c) : p as Profile;
  const plan = suit ? manualPlan(c, worn, suit, c ? p.race || "human" : null, on, edits) : buffPlanOf(c, worn, p.race, rb, edits);
  const profile = plannedProfile(base, c, plan);
  const strLimit = p.strLimit ?? defaultStrLimit(c);
  const settings = { allowOthersWorn: !!p.allowOthersWorn, strLimit, excludeTags: p.excludeTags || [], excludeRoots: p.excludeRoots || [], allowGargoyle: !!p.allowGargoyle, medOnly: !!p.medOnly,
    excludeWeapons: p.excludeWeapons || [], ubwsAnyWeapon: p.ubwsAnyWeapon !== false, excludeSkills: p.excludeSkills || [], lockedSlots: p.lockedSlots || [] };
  const snapshot = { ...settings, floors: p.floors || {}, softFloors: p.softFloors || [], weights: p.weights || {}, race: p.race || "human", resistCaps: p.resistCaps || {}, ...(rb ? { buffs: rb } : {}) };
  const opts = { restarts: RUN_DEFAULTS.restarts, exact: true, timeBudgetMs: budget, ...(alt ? { alternatives: { count: alt, tolerance: 0 } } : {}) };
  return { profile, base, plan, settings, opts, snapshot: { ...snapshot, restarts: RUN_DEFAULTS.restarts, exact: true, budgetMs: budget, altCount: alt, altTol: 0 } };
}
const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v));   // undefined fields dropped, as the request body drops them

test("[fast] planBuild: the page's build, profile, pool, search options and run snapshot alike", () => {
  const KNOBS: Knobs[] = [
    { strLimit: "95", restarts: "200", exact: true, budgetS: "300", altCount: "5", altTol: "40" },
    { strLimit: "95", restarts: "50", exact: false, budgetS: "300", altCount: "0", altTol: "0" },
    { strLimit: "95", restarts: "200", exact: true, budgetS: "60", altCount: "0", altTol: "0" },
  ];
  for (const name of ["Kestrel", "Dorran"]) for (const c of [withSkills(inv.characters[name]!), inv.characters[name]!]) {
    for (const [on, edits] of [[[], {}], [["divineFury"], {}], [["divineFury", "bless"], { Chivalry: 90 }]] as Array<[string[], Record<string, number>]>) {
      for (const knobs of KNOBS) {
        const want = pageBuild(PANEL, c, wornBy[name] || [], on, edits, knobs);
        const spec: BuildSpec = { ...specFromProfile(PANEL, { on, skills: edits }),
          search: { restarts: Number(knobs.restarts), exact: knobs.exact, budgetMs: 1000 * Number(knobs.budgetS), altCount: Number(knobs.altCount), altTol: Number(knobs.altTol) } };
        const got = planBuild(spec, { character: c, worn: wornBy[name] || [], race: PANEL.race });
        const label = `${name} ${on.join("+") || "no buffs"} ${JSON.stringify(knobs)}`;
        assert.deepEqual(got.profile, want.profile, `${label}: profile`);
        assert.deepEqual(json(got.pool), json(want.settings), `${label}: pool settings`);
        assert.deepEqual(got.opts, want.opts, `${label}: opts`);
        assert.deepEqual(json(got.snapshot), json(want.snapshot), `${label}: snapshot`);
      }
    }
  }
});

test("[fast] planBuild: the MCP tools' plan, for a character, No character and a hand-picked suit", () => {
  const noStr = { ...PANEL, strLimit: undefined };
  for (const [name, c] of [["Kestrel", withSkills(inv.characters.Kestrel!)], ["Dorran", inv.characters.Dorran!], [null, null]] as Array<[string | null, Character | null]>) {
    const worn = name ? wornBy[name] || [] : [];
    const suits: Array<Record<string, Item> | null> = [null, Object.fromEntries(worn.filter((i) => i.slot).slice(0, 4).map((i) => [i.slot!, i]))];
    for (const p of [PANEL, noStr]) for (const suit of name ? suits : [suits[1]!]) for (const [on, edits] of [[[], {}], [["divineFury"], { Chivalry: 90 }]] as Array<[string[], Record<string, number>]>) {
      for (const [budget, alt] of [[60_000, 0], [120_000, 3]] as Array<[number, number]>) {
        const want = mcpBuild(p, c, worn, on, edits, suit, budget, alt);
        const spec: BuildSpec = { ...specFromProfile(p, { on, skills: edits }), search: { budgetMs: budget, exact: true, altCount: alt } };
        const got = planBuild(spec, { character: c, worn, race: p.race, ...(suit ? { suit } : {}) });
        const label = `${name ?? "No character"} strLimit ${p.strLimit ?? "character"} ${suit ? "suit" : "auto"} ${on.join("+") || "no buffs"} ${budget}/${alt}`;
        assert.deepEqual(got.profile, want.profile, `${label}: profile`);
        assert.deepEqual(got.plan, want.plan, `${label}: plan`);
        assert.deepEqual(json(got.pool), json(want.settings), `${label}: pool settings`);
        assert.deepEqual(got.opts, want.opts, `${label}: opts`);
        assert.deepEqual(json(got.snapshot), json(want.snapshot), `${label}: snapshot`);
      }
    }
  }
});

// ---- profiles.json v3
const GOLD = join(HERE, "fixtures", "profiles-v2");
const gold = (n: string): unknown => JSON.parse(readFileSync(join(GOLD, n), "utf8"));
const V3_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as ValidatorSchema;

test("[fast] build spec: a hand-edited spec whose lists or maps are the wrong type still reads, as defaults", () => {
  const odd = { intent: { floors: [1], softFloors: "hci", weights: "x", resistCaps: 5 }, pool: { lockedSlots: 5, excludeTags: { a: 1 }, excludeRoots: "bank" }, buffs: { on: "bless", skills: [] } };
  const got = buildSpec(odd as unknown as BuildSpecSource);
  assert.deepEqual([got.intent.floors, got.intent.softFloors, got.intent.weights, got.intent.resistCaps], [{}, [], {}, {}]);
  assert.deepEqual([got.pool.lockedSlots, got.pool.excludeTags, got.pool.excludeRoots, got.buffs.on, got.buffs.skills], [[], [], [], [], {}]);
  const v3: ProfilesV3 = { schemaVersion: 3, characters: { A: { spec: odd } as unknown as CharacterEntry, B: {} as CharacterEntry }, templates: {} };
  assert.deepEqual(characterProfile(v3, "A").lockedSlots, [], "the panel opens");
  assert.deepEqual(characterBuffs(v3, "B"), { on: [], skills: {} }, "an entry with no spec");
  const schema = (JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as { $defs: { character: { properties: { race: { enum: string[] } } } } });
  assert.deepEqual(schema.$defs.character.properties.race.enum, [...RACES], "the schema names the same races");
});

test("[fast] profiles v3: a bad v2 value is healed key by key and said; empty buff entries and unscanned names make no profile", () => {
  const { profiles, healed } = migrateProfilesV3(gold("profiles.json") as ProfilesFile, gold("ui-prefs.json") as Record<string, unknown>);
  assert.deepEqual(healed, [
    "characters.Aldric: weights.someProp \"3\" left out",
    "characters.Aldric: excludeWeapons item \"bows\" left out",
    "characters.Brena: softFloors \"lrc\" set to its default",
    "characters.Brena: lockedSlots 5 set to its default",
    "characters.Brena: medOnly \"yes\" read as true",
    "characters.Brena: strLimit 5000 set to its default",
  ]);
  assert.deepEqual(profiles.characters.Aldric!.spec.intent.weights, { dci: 10, ssi: 5, tagPenalty: -25 }, "only the bad weight goes");
  assert.deepEqual(profiles.characters.Aldric!.spec.pool.excludeWeapons, ["archery", "throwing"]);
  assert.equal(profiles.characters.Brena!.spec.pool.medOnly, true, "read as v2 read it");
  assert.deepEqual(Object.keys(profiles.characters), ["Aldric", "Brena", "Corwin"], "Dara's empty list and Eli's empty edits make no profile");
  const only = migrateProfilesV3(gold("profiles.json") as ProfilesFile, gold("ui-prefs.json") as Record<string, unknown>, { scanned: (n) => n !== "Corwin" });
  assert.deepEqual(Object.keys(only.profiles.characters), ["Aldric", "Brena"], "a forgotten character's leftover buffs bring no profile back");
  assert.equal(only.healed.at(-1), "characters.Corwin: not scanned, so its buffs were not moved (they stay in the ui-prefs backup)");
  // leftover keys beside a v3 file go; No character's numbers carry over when ui-prefs has none of its own
  const left = migrateProfilesV3(profiles, { theme: "default", buffSkills: { "": { Chivalry: 80 } } } as Record<string, unknown>);
  assert.deepEqual([left.changed, left.prefsChanged, left.prefs], [false, true, { theme: "default", manualBuffSkills: { Chivalry: 80 } }]);
  assert.deepEqual(migrateProfilesV3(profiles, { manualBuffSkills: { Chivalry: 90 }, buffSkills: { "": { Chivalry: 80 } } } as Record<string, unknown>).prefs, { manualBuffSkills: { Chivalry: 90 } });
});

test("[fast] profiles v3: the migration is idempotent, its result passes PUT /api/profiles' checks, and a newer file is left alone", () => {
  const once = migrateProfilesV3(gold("profiles.json") as ProfilesFile, gold("ui-prefs.json") as Record<string, unknown>);
  assert.deepEqual(once.profiles, gold("expected.profiles.json"));
  assert.deepEqual(once.prefs, gold("expected.ui-prefs.json"));
  assert.deepEqual([once.changed, once.prefsChanged], [true, true]);
  const twice = migrateProfilesV3(once.profiles, once.prefs);
  assert.deepEqual([twice.changed, twice.prefsChanged], [false, false]);
  assert.equal(twice.profiles, once.profiles, "the same file back");
  assert.deepEqual(validate(V3_SCHEMA, once.profiles).errors, []);
  assert.equal(profilesSpecError(once.profiles), null);
  const newer = { schemaVersion: 4, characters: { A: { whatever: 1 } }, templates: {} };
  assert.deepEqual(migrateProfilesV3(newer as never, {}), { profiles: newer, prefs: {}, changed: false, prefsChanged: false, healed: [] });
  assert.deepEqual(migrateProfilesV3({}, {}).profiles, { schemaVersion: 3, characters: {}, templates: {} }, "an empty file");
});

// What a Pack Rat from before v3 does with a v3 file, as its code read it: its store migrates on read (vault-lib's
// migrateProfiles, unchanged since), its page opens a character with characterProfile (below, as written then) and its
// PUT /api/profiles checks a body against the v2 schema (kept in the fixture folder).
function v2CharacterProfile(profiles: ProfilesFile, name: string): CharacterEntryRaw {
  const saved = profiles.characters && Object.hasOwn(profiles.characters, name) ? profiles.characters[name] : undefined;
  if (saved) return JSON.parse(JSON.stringify(saved)) as CharacterEntryRaw;
  const [first] = Object.keys(profiles.templates || {});
  return { ...templateFrom(first ? profiles.templates![first] : undefined), template: first, race: "human" };
}
test("[fast] profiles v3: an older Pack Rat reads a v3 file as no settings and can't write over it", () => {
  const v3 = gold("expected.profiles.json") as ProfilesFile;
  assert.equal(migrateProfiles(v3).changed, false, "its store's migration leaves the file as it is, so it is never rewritten on read");
  const opened = v2CharacterProfile(v3, "Aldric");
  assert.deepEqual(templateFrom(opened), templateFrom(), "its panel shows no settings for a saved character");
  const v2Schema = gold("profiles.v2.schema.json") as ValidatorSchema;
  const saved = { ...v3, characters: { ...v3.characters, Aldric: { ...opened, floors: { hci: 1 } } } };
  assert.match(validate(v2Schema, saved).errors.map((e) => `${e.path} ${e.msg}`).join("; "), /^\/schemaVersion /, "its Save profile is refused: the file keeps the buffs and settings");
});

test("[fast] profiles v3: characterProfile and the templates, the player's own first and then the built-in ones", () => {
  const v3 = gold("expected.profiles.json") as ProfilesV3, builtins = (JSON.parse(readFileSync(join(HERE, "data", "templates", "uoalive.json"), "utf8")) as { templates: TemplateMap }).templates;
  const aldric = characterProfile(v3, "Aldric", builtins);
  assert.equal(aldric.strLimit, 95);
  assert.equal(aldric.race, "elf");
  assert.equal(aldric.template, "melee");
  assert.equal("buffs" in aldric, false, "the buffs are characterBuffs'");
  assert.deepEqual(characterBuffs(v3, "Aldric"), { on: ["divineFury", "consecrateWeapon"], skills: { Chivalry: 90 } });
  assert.deepEqual(characterBuffs(v3, "Nobody"), { on: [], skills: {} });
  assert.deepEqual(characterProfile(v3, "Nobody", builtins), { ...templateSettings(v3.templates.melee!), template: "melee", race: "human" }, "no saved settings: the player's first template");
  const fresh: ProfilesV3 = { schemaVersion: 3, characters: {}, templates: {} };
  assert.deepEqual(characterProfile(fresh, "Nobody", builtins), { ...templateSettings(builtins.melee!), template: "builtin:melee", race: "human" }, "with none of the player's own, the first built-in");
  assert.deepEqual(characterProfile(fresh, "Nobody"), { ...templateFrom(), template: undefined, race: "human" });
  assert.deepEqual(templateRefs(v3, builtins), ["melee", "my caster", "builtin:melee", "builtin:caster", "builtin:archer", "builtin:tank"]);
  assert.equal(findTemplate(v3, builtins, "melee"), v3.templates.melee);
  assert.equal(findTemplate(v3, builtins, "builtin:melee"), builtins.melee);
  assert.equal(findTemplate(v3, builtins, "builtin:nope"), undefined);
  assert.equal(findTemplate(v3, builtins, "constructor"), undefined, "never a prototype's");
  assert.equal(templateLabel(builtins, "builtin:melee"), "Melee (built-in)");
  assert.equal(templateLabel(builtins, "my caster"), "my caster");
});

test("[fast] built-in templates: every shipped file's templates pass the spec check, carry a name and the v3 shape", () => {
  const dir = join(HERE, "data", "templates");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.includes("uoalive.json"));
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(dir, f), "utf8")) as { schemaVersion: number; templates: TemplateMap };
    assert.equal(doc.schemaVersion, 3, f);
    assert.ok(Object.keys(doc.templates).length, f);
    for (const [id, t] of Object.entries(doc.templates)) {
      assert.equal(buildSpecError(t.spec, `${f} ${id}`, { template: true }), null);
      assert.equal(typeof t.name, "string", `${f} ${id} has a name`);
    }
  }
  // The four templates new data folders used to be seeded with, kept as uoalive's built-ins setting for setting.
  const shipped = (JSON.parse(readFileSync(join(dir, "uoalive.json"), "utf8")) as { templates: TemplateMap }).templates;
  assert.deepEqual(Object.keys(shipped), ["melee", "caster", "archer", "tank"]);
});
