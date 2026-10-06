// migrate.test.mts — `app/migrate.mts`, the one registry of data-file migrations: every golden file in `app/fixtures/golden/<kind>/<version>.json` loads through `migrate` to its kind's current version and passes that kind's own check, and migrating it again changes nothing; every kind has a golden file at its current version; a document newer than the build comes back untouched and marked `newer`, with the "made by a newer Pack Rat" notice; `version` and `schemaVersion` read as one field, written as the file writes it; a document with no version its kind accepts comes back untouched for its reader to refuse; and each kind's steps are in order and end at its current version.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_KINDS, migrate, newerNotice, versionOf, type DocKind } from "./migrate.mts";
import { validateScan } from "./scan-schema.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { profilesSpecError, type ProfilesV3 } from "./build-spec.mts";
import { checkOrganizeConfig } from "./organize-config.mts";
import { salvageOrganizeState } from "./organize-state.mts";
import { salvageKindOverrides } from "./item-kinds.mts";
import { checkHouseEntry, isHouseId } from "./house-names.mts";
import { readMcpConfig } from "./mcp.mts";
import { createSettingsStore } from "./store/settings.mts";
import { createUiPrefsStore } from "./store/ui-prefs.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const GOLDEN = join(HERE, "fixtures", "golden");
const V3_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as ValidatorSchema;
const KINDS = Object.keys(DOC_KINDS) as DocKind[];
const goldens = readdirSync(GOLDEN).flatMap((kind) => readdirSync(join(GOLDEN, kind)).map((f) => ({ kind: kind as DocKind, file: join(GOLDEN, kind, f), version: Number(f.replace(/\.json$/, "")) })));
const quiet = (t: TestContext): (() => string[]) => { const got: string[] = []; t.mock.method(console, "warn", (m: string) => got.push(m)); return () => got; };

// Each kind's own check of a document at its current version: what its reader or its PUT route holds a document to.
// `file` is the golden file itself, for the readers that only read files (they are given a valid one, so none writes).
const CHECKS: Record<DocKind, (doc: unknown, file: string, raw: unknown) => void> = {
  scan: (doc) => assert.deepEqual(validateScan(doc).errors, []),
  profiles: (doc) => { assert.deepEqual(validate(V3_SCHEMA, doc).errors, []); assert.equal(profilesSpecError(doc as ProfilesV3), null); },
  runs: (doc) => {
    const run = doc as { schemaVersion: number; settings: Record<string, unknown>; result?: { proven?: unknown } };
    assert.equal(run.schemaVersion, 1);
    for (const key of ["weaponSkill", "allowOthers", "budgetS"]) assert.equal(key in run.settings, false, key);
    assert.equal(run.result?.proven, undefined, "a proof from solver 1 is withdrawn");
  },
  organize: (doc) => assert.equal(checkOrganizeConfig(doc).ok, true, JSON.stringify(checkOrganizeConfig(doc))),
  "organize-state": (doc) => assert.deepEqual(salvageOrganizeState(doc), doc),
  "item-kinds": (doc) => assert.deepEqual(salvageKindOverrides(doc).problems, []),
  "house-map": (doc) => {
    for (const [id, entry] of Object.entries((doc as { houses: Record<string, unknown> }).houses)) {
      assert.ok(isHouseId(id), id);
      assert.deepEqual(checkHouseEntry(entry), { ok: true, entry }, id);
    }
  },
  mcp: (doc, file) => { const warned: string[] = []; assert.deepEqual(readMcpConfig(file, (m) => warned.push(m)), doc); assert.deepEqual(warned, []); },
  settings: (doc, file) => { const warned: string[] = []; assert.deepEqual(createSettingsStore({ file, warn: (m) => warned.push(m) }).load(), doc); assert.deepEqual(warned, []); },
  "ui-prefs": (doc, file) => assert.deepEqual(createUiPrefsStore(file).read(), doc),
};

test("[smoke] migrate: every golden file loads to its kind's current version, passes its check, and migrating it again changes nothing", (t) => {
  quiet(t);
  assert.ok(goldens.length >= KINDS.length);
  for (const g of goldens) {
    assert.ok(KINDS.includes(g.kind), `${g.kind} is not a kind`);
    const raw: unknown = JSON.parse(readFileSync(g.file, "utf8")), at = `${g.kind}/${g.version}.json`;
    assert.equal(versionOf(g.kind, raw), g.version, at);
    const m = migrate(g.kind, raw, { shard: "uoalive" });
    assert.deepEqual([m.fromVersion, m.newer], [g.version, false], at);
    assert.equal(versionOf(g.kind, m.doc), DOC_KINDS[g.kind].current, at);
    CHECKS[g.kind](m.doc, g.file, raw);
    assert.equal(migrate(g.kind, m.doc, { shard: "uoalive" }).changed, false, `${at} migrated twice`);
  }
});

test("[fast] migrate: every kind has a golden file at its current version", () => {
  for (const kind of KINDS) assert.ok(goldens.some((g) => g.kind === kind && g.version === DOC_KINDS[kind].current), kind);
});

test("[fast] migrate: a document newer than this build comes back untouched and marked newer, with the notice", () => {
  for (const kind of KINDS.filter((k) => DOC_KINDS[k].field)) {
    const doc = { [DOC_KINDS[kind].field!]: DOC_KINDS[kind].current + 1, weaponSkill: "archery", settings: { budgetS: 3 } };
    assert.deepEqual(migrate(kind, doc), { doc, changed: false, fromVersion: DOC_KINDS[kind].current + 1, newer: true }, kind);
    assert.equal(newerNotice("x.json", kind, doc), `x.json was made by a newer Pack Rat (version ${DOC_KINDS[kind].current + 1}); it is read-only here until Pack Rat is updated`);
    assert.equal(newerNotice("x.json", kind, { [DOC_KINDS[kind].field!]: DOC_KINDS[kind].current }), null);
  }
  assert.equal(newerNotice("ui-prefs.json", "ui-prefs", { version: 9 }), null, "ui-prefs.json has no version");
});

test("[fast] migrate: version and schemaVersion read as one field, and come back as the field the file writes", () => {
  assert.deepEqual(migrate("organize", { schemaVersion: 1, labels: {} }).doc, { labels: {}, version: 1 });
  assert.deepEqual(migrate("settings", { version: 1, shard: "uoalive" }), { doc: { shard: "uoalive", schemaVersion: 1 }, changed: true, fromVersion: 1, newer: false });
  assert.equal(migrate("house-map", { schemaVersion: 2, houses: {} }).newer, true);
  const kept = { version: 1, houses: {} };
  assert.equal(migrate("house-map", kept).doc, kept, "a document with nothing to change comes back itself");
});

test("[fast] migrate: a document with no version its kind accepts, or not an object, comes back untouched for its reader to refuse", () => {
  for (const [kind, doc] of [["organize", {}], ["house-map", { version: "1" }], ["scan", { character: "Kestrel" }], ["mcp", {}], ["runs", null], ["profiles", [1]]] as const) {
    assert.deepEqual(migrate(kind, doc), { doc, changed: false, fromVersion: null, newer: false }, kind);
  }
  assert.equal(migrate("runs", { id: "r" }).fromVersion, 1, "a run without schemaVersion is version 1");
  assert.equal(migrate("profiles", {}).fromVersion, 0, "an unversioned profiles.json is version 0");
});

test("[fast] migrate: each kind's steps are in order and end at its current version", () => {
  for (const kind of KINDS) {
    const { steps, current } = DOC_KINDS[kind] as { steps: { from: number; to: number }[]; current: number };
    for (const [i, s] of steps.entries()) {
      assert.ok(s.from <= s.to && s.to <= current, `${kind} step ${i}`);
      if (i) assert.ok(steps[i - 1]!.from <= s.from, `${kind} step ${i} is out of order`);
    }
  }
});
