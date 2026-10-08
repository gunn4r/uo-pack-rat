// builtin-templates.test.mts — the shipped built-in templates (`app/data/templates/<shard>.json`, issue #212) as data.
//
// `[fast]`: every built-in in every shipped file passes `buildSpecError` as a template and the profiles store keeps all of them (none left out with a log line); ids are unique in the file's text (JSON.parse keeps the last of a repeated key) and camelCase, names unique and at most 64 characters; every build template (all but the four generic starters) has a description, sources that are uoalive.com pages (none allowed) and buffs; the buffs are a legal list with at most one form, at most one mastery (a passive counts as the template's chosen mastery) and a Gargoyle-only buff only where gargoyle gear is allowed; no positively weighted property is worth `DOMINANT_WORTH` times the median of the others (the generic starters exempt); and `castingSchool` is a known school, named whenever Faster Casting is floored or weighted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildSpecError, templateSettings, type TemplateMap } from "./build-spec.mts";
import { buffById, isBuffList } from "./buffs.mts";
import { CASTING_SCHOOLS, effectiveProfile, playerCaps, setRules, typicalRange } from "./vault-lib.mts";
import { DOMINANT_WORTH } from "./diagnostics.mts";
import { createProfilesStore } from "./store/profiles.mts";
import { createUiPrefsStore } from "./store/ui-prefs.mts";

const APP = fileURLToPath(new URL(".", import.meta.url)), TEMPLATES = join(APP, "data", "templates");
setRules(JSON.parse(readFileSync(join(APP, "rules", "uoalive.json"), "utf8")));
const SHARDS = ["uoalive", "generic-osi"];
const raw = (shard: string): string => readFileSync(join(TEMPLATES, `${shard}.json`), "utf8");
const templatesOf = (shard: string): TemplateMap => (JSON.parse(raw(shard)) as { templates: TemplateMap }).templates;
// The shard-neutral starters (#212 design §3): resists 65 and small floors, kept as they are. `archer` and `tank` exceed
// the worth ratio on paper but not on a real suit (diagnostics.test.mts), and the solver-equivalence hashes pin them.
const GENERIC = ["melee", "caster", "archer", "tank"];
const builds = Object.entries(templatesOf("uoalive")).filter(([id]) => !GENERIC.includes(id));

test("[fast] built-in templates: every shipped one passes the spec check and the profiles store keeps it", () => {
  for (const shard of SHARDS) {
    const all = templatesOf(shard), logged: string[] = [], d = mkdtempSync(join(tmpdir(), "qm-builtins-"));
    for (const [id, t] of Object.entries(all)) assert.equal(buildSpecError(t.spec, `${shard} ${id}`, { template: true }), null);
    const store = createProfilesStore({ file: join(d, "profiles.json"), defaults: join(APP, "data", "profiles.default.json"), templatesDir: TEMPLATES, shard: () => shard, log: (line) => logged.push(line), uiPrefs: createUiPrefsStore(join(d, "ui-prefs.json")) });
    assert.deepEqual(Object.keys(store.builtins()), Object.keys(all), shard);
    assert.deepEqual(logged, [], shard);
  }
  assert.deepEqual(Object.keys(templatesOf("uoalive")).slice(0, 4), GENERIC, "the generic starters stay first");
});

test("[fast] built-in templates: ids unique and camelCase, names unique and short", () => {
  for (const shard of SHARDS) {
    const ids = [...raw(shard).matchAll(/^ {4}"([^"]+)": \{$/gm)].map((m) => m[1]!), all = templatesOf(shard);
    assert.equal(ids.length, Object.keys(all).length, `${shard}: every template id is on a line of its own`);
    assert.equal(new Set(ids).size, ids.length, `${shard}: a repeated id (JSON.parse keeps only the last)`);
    for (const id of ids) assert.match(id, /^[a-z][A-Za-z]*$/, `${shard} ${id}`);
    const names = Object.values(all).map((t) => t.name ?? "");
    assert.equal(new Set(names).size, names.length, `${shard}: names unique`);
    for (const n of names) assert.ok(n.length > 0 && n.length <= 64, `${shard} name "${n}"`);
  }
});

test("[fast] built-in templates: each build template says what it is, where it comes from and what it loads", () => {
  assert.equal(builds.length, 13);
  for (const [id, t] of builds) {
    assert.ok(typeof t.description === "string" && t.description.trim(), `${id} description`);
    assert.ok(Array.isArray(t.sources) && t.sources.every((s) => typeof s === "string" && s.startsWith("https://uoalive.com/")), `${id} sources`);
    assert.ok(t.spec.buffs, `${id} buffs`);
    assert.deepEqual(t.spec.buffs!.skills, {}, `${id}: the numbers are the character's`);
  }
});

// The mastery each song or active belongs to; a passive (Intuition, Saving Throw) belongs to whichever mastery the
// player chose, so it counts only when nothing else names one.
const MASTERY: Record<string, string> = { inspire: "Provocation", invigorate: "Provocation", resilience: "Peacemaking", perseverance: "Peacemaking",
  focusedEye: "Swordsmanship", toughness: "Mace Fighting", rampage: "Wrestling", playingTheOdds: "Archery", whiteTiger: "Ninjitsu" };
const PASSIVE = ["intuition", "savingThrow"];

test("[fast] built-in templates: buffs are a legal list, one form, one mastery, and Gargoyle-only buffs only with gargoyle gear", () => {
  for (const shard of SHARDS) for (const [id, t] of Object.entries(templatesOf(shard))) {
    const on = t.spec.buffs?.on ?? [];
    assert.ok(isBuffList(on), `${shard} ${id}: a known list`);
    assert.ok(on.filter((b) => buffById(b)!.excl === "form").length <= 1, `${shard} ${id}: one form`);
    const masteries = new Set(on.flatMap((b) => (MASTERY[b] ? [MASTERY[b]] : [])));
    assert.ok(masteries.size + (masteries.size === 0 && on.some((b) => PASSIVE.includes(b)) ? 1 : 0) <= 1, `${shard} ${id}: one mastery`);
    for (const b of on) if (buffById(b)!.race === "gargoyle") assert.equal(t.spec.pool.allowGargoyle, true, `${shard} ${id}: ${b} needs gargoyle gear`);
  }
});

test("[fast] built-in templates: no weight's worth swamps the others", () => {
  const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
  for (const [id, t] of builds) {
    const p = templateSettings(t), spans = playerCaps(effectiveProfile(p));
    const worths = Object.entries(p.weights || {}).flatMap(([k, w]) => { const typical = w > 0 ? typicalRange(k, spans) : null; return typical != null ? [{ k, worth: w * typical }] : []; });
    for (const { k, worth } of worths) {
      const mid = median(worths.filter((x) => x.k !== k).map((x) => x.worth));
      assert.ok(worth < DOMINANT_WORTH * mid, `${id} ${k}: worth ${worth} against a median of ${mid}`);
    }
  }
});

test("[fast] built-in templates: the casting school is a known one, and named wherever Faster Casting counts", () => {
  for (const shard of SHARDS) for (const [id, t] of Object.entries(templatesOf(shard))) {
    const { castingSchool, floors, weights } = t.spec.intent;
    if (castingSchool !== undefined) assert.ok(CASTING_SCHOOLS.includes(castingSchool), `${shard} ${id}: ${castingSchool}`);
    if (GENERIC.includes(id)) continue;   // the generic Caster predates the casting school and takes the cap from the character's skills
    if (floors.fc != null || (weights.fc ?? 0) !== 0) assert.ok(castingSchool, `${shard} ${id}: Faster Casting counts, so the school is named`);
  }
});
