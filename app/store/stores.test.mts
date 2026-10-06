// stores.test.mts — each store in `app/store/` on its own: size caps, bad files and the exact bytes written.
//
// each store in `app/store/` on its own: its size cap at the cap and one byte past it (blacklist 256 KiB, organize-state 4 MB, item-kinds and organize their own limits), what a missing, damaged or partly bad file reads as (moved aside, empty, salvaged or skipped) with the exact warning, log or problem text, and the exact bytes each write leaves (indent, trailing newline, a run compact with none). All `[fast]`; they pin the policies the routes rely on while the server is split.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createSettingsStore } from "./settings.mts";
import { createProfilesStore } from "./profiles.mts";
import { createUiPrefsStore } from "./ui-prefs.mts";
import { createBlacklistStore } from "./blacklist.mts";
import { createItemKindsStore } from "./item-kinds.mts";
import { createOrganizeStore } from "./organize.mts";
import { createOrganizeStateStore } from "./organize-state.mts";
import { createRunsStore } from "./runs.mts";
import { createScansStore } from "./scans.mts";
import { emptyKindOverrides, kindsText, MAX_KINDS_BYTES } from "../item-kinds.mts";
import { emptyOrganizeConfig, MAX_SETUP_BYTES } from "../organize-config.mts";
import { emptyOrganizeState } from "../organize-state.mts";
import { DEFAULT_SHARD } from "../rules.mts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const dir = (): string => mkdtempSync(join(tmpdir(), "pr-stores-"));
// JSON text padded with trailing spaces to exactly `bytes` bytes (JSON.parse ignores them).
const padded = (doc: unknown, bytes: number): string => { const text = JSON.stringify(doc); return text + " ".repeat(bytes - Buffer.byteLength(text)); };
const warnings = (t: TestContext, method: "warn" | "error" = "warn"): (() => string[]) => {
  const m = t.mock.method(console, method, () => {});
  return () => m.mock.calls.map((c) => String(c.arguments[0]));
};

test("[fast] stores: settings reads a missing file as the defaults, moves a damaged one aside and writes the defaults with a warning, and writes indent 2 with a newline", () => {
  const d = dir(), f = join(d, "settings.json"), warned: string[] = [];
  const store = createSettingsStore({ file: f, warn: (m) => warned.push(m) });
  const defaults = { schemaVersion: 1, shard: DEFAULT_SHARD };
  assert.deepEqual(store.load(), defaults);
  assert.equal(existsSync(f), false, "a missing file is not written");
  writeFileSync(f, "[1]");
  assert.deepEqual(store.load(), defaults);
  assert.equal(readFileSync(`${f}.corrupt`, "utf8"), "[1]");
  assert.equal(readFileSync(f, "utf8"), `{\n  "schemaVersion": 1,\n  "shard": "${DEFAULT_SHARD}"\n}\n`);
  assert.deepEqual(warned, [`settings.json is unreadable (not a JSON object); starting on defaults — the old file was kept as ${f}.corrupt`]);
  writeFileSync(f, "{oops");
  store.load();
  assert.match(warned[1]!, /^settings\.json is unreadable \(invalid JSON: syntax error at position 1\); starting on defaults — the old file was kept as .*settings\.json\.corrupt-\d+$/);
  store.write({ schemaVersion: 1, shard: "x", setupDone: true });
  assert.equal(readFileSync(f, "utf8"), "{\n  \"schemaVersion\": 1,\n  \"shard\": \"x\",\n  \"setupDone\": true\n}\n");
});

// A profiles store over `d`, with its ui-prefs store beside it and the shipped built-in templates.
function profilesIn(d: string, logged: string[] = [], shard = "uoalive") {
  const uiPrefs = createUiPrefsStore(join(d, "ui-prefs.json"));
  return createProfilesStore({ file: join(d, "profiles.json"), defaults: join(APP, "data", "profiles.default.json"), templatesDir: join(APP, "data", "templates"), shard: () => shard, log: (line) => logged.push(line), uiPrefs });
}
const backups = (d: string): string[] => readdirSync(d).filter((n) => n.includes(".backup-")).sort();

test("[fast] stores: profiles seeds a missing file from the defaults, moves a damaged one aside and reseeds it with a log line, and writes indent 2 with a newline", async () => {
  const d = dir(), f = join(d, "profiles.json"), defaults = join(APP, "data", "profiles.default.json"), logged: string[] = [];
  const store = profilesIn(d, logged);
  const seeded = await store.read();
  assert.equal(readFileSync(f, "utf8"), readFileSync(defaults, "utf8"), "seeded byte for byte");
  writeFileSync(f, "null");
  assert.deepEqual(await store.read(), seeded);
  assert.equal(readFileSync(`${f}.corrupt`, "utf8"), "null");
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /^\S+ profiles\.json is unreadable \(not a JSON object\); reseeded from the defaults — the old file was kept as .*profiles\.json\.corrupt\n$/);
  store.write({ schemaVersion: 3, characters: {}, templates: {} });
  assert.equal(readFileSync(f, "utf8"), "{\n  \"schemaVersion\": 3,\n  \"characters\": {},\n  \"templates\": {}\n}\n");
  assert.deepEqual(backups(d), [], "a new or reseeded file needs no backup");
});

// The v2 → v3 migration on real files (app/fixtures/profiles-v2/): a v2 profiles.json and its ui-prefs.json become the
// golden v3 file and ui-prefs, each kept first as a dated backup, byte for byte; reading again changes nothing.
test("[fast] stores: profiles migrates a v2 file and its ui-prefs to v3 once, with a dated backup of each", async () => {
  const d = dir(), gold = join(APP, "fixtures", "profiles-v2"), day = new Date().toISOString().slice(0, 10);
  for (const n of ["profiles.json", "ui-prefs.json"]) copyFileSync(join(gold, n), join(d, n));
  const store = profilesIn(d);
  const got = await store.read();
  assert.equal(readFileSync(join(d, "profiles.json"), "utf8"), readFileSync(join(gold, "expected.profiles.json"), "utf8"), "the golden v3 file");
  assert.deepEqual(got, JSON.parse(readFileSync(join(gold, "expected.profiles.json"), "utf8")));
  assert.deepEqual(JSON.parse(readFileSync(join(d, "ui-prefs.json"), "utf8")), JSON.parse(readFileSync(join(gold, "expected.ui-prefs.json"), "utf8")), "autoBuffs and buffSkills gone, No character's numbers kept");
  assert.deepEqual(backups(d), [`profiles.backup-${day}.json`, `ui-prefs.backup-${day}.json`]);
  for (const n of ["profiles", "ui-prefs"]) assert.equal(readFileSync(join(d, `${n}.backup-${day}.json`), "utf8"), readFileSync(join(gold, `${n}.json`), "utf8"), `${n}: the file as it was`);
  const before = readFileSync(join(d, "profiles.json"), "utf8");
  assert.deepEqual(await store.read(), got, "idempotent");
  assert.equal(readFileSync(join(d, "profiles.json"), "utf8"), before, "not rewritten");
  assert.equal(backups(d).length, 2, "no second backup");
  // ui-prefs keys left behind (the write after the profiles one was cut short) leave on the next read, kept once more first
  writeFileSync(join(d, "ui-prefs.json"), JSON.stringify({ theme: "default", autoBuffs: { Aldric: ["bless"] } }));
  assert.deepEqual(await store.read(), got, "the profiles keep what they hold");
  assert.deepEqual(JSON.parse(readFileSync(join(d, "ui-prefs.json"), "utf8")), { theme: "default" });
  assert.deepEqual(backups(d), [`profiles.backup-${day}.json`, `ui-prefs.backup-${day}-2.json`, `ui-prefs.backup-${day}.json`]);
});

test("[fast] stores: profiles hands out the shard's built-in templates, none for a shard that ships none, and leaves a bad one out with a log line", () => {
  const d = dir(), logged: string[] = [];
  assert.deepEqual(Object.keys(profilesIn(d).builtins()), ["melee", "caster", "archer", "tank"]);
  assert.deepEqual(profilesIn(d, logged, "no-such-shard").builtins(), {});
  const tpl = join(d, "templates");
  mkdirSync(tpl);
  writeFileSync(join(tpl, "test.json"), JSON.stringify({ schemaVersion: 3, templates: { good: { spec: { intent: {}, pool: {} } }, bad: { spec: { intent: { floors: { hci: "x" } }, pool: {} } } } }));
  const store = createProfilesStore({ file: join(d, "profiles.json"), defaults: join(APP, "data", "profiles.default.json"), templatesDir: tpl, shard: () => "test", log: (line) => logged.push(line), uiPrefs: createUiPrefsStore(join(d, "ui-prefs.json")) });
  assert.deepEqual(Object.keys(store.builtins()), ["good"]);
  assert.match(logged[0]!, /a built-in template was left out: test\.json templates\.bad\.spec\.intent\.floors\.hci must be a number/);
});

test("[fast] stores: ui-prefs reads a missing or damaged file as nothing chosen, keeps only the valid fields, and writes indent 2 with a newline", () => {
  const d = dir(), f = join(d, "ui-prefs.json"), store = createUiPrefsStore(f);
  assert.deepEqual(store.read(), {});
  writeFileSync(f, "{oops");
  assert.deepEqual(store.read(), {});
  writeFileSync(f, JSON.stringify({ theme: "britannia", density: "huge", cols: ["a", 3], mapDrawerWidth: 500, colWidths: { a: 10 } }));
  assert.deepEqual(store.read(), { theme: "britannia", mapDrawerWidth: 500 });
  assert.ok(existsSync(f), "never moved aside");
  store.write({ theme: "default", cols: ["a"] });
  assert.equal(readFileSync(f, "utf8"), "{\n  \"theme\": \"default\",\n  \"cols\": [\n    \"a\"\n  ]\n}\n");
});

test("[fast] stores: blacklist reads up to 256 KiB, a larger, missing or damaged file as empty, only valid entries, and writes indent 1 with a newline", () => {
  const d = dir(), f = join(d, "scan-blacklist.json"), store = createBlacklistStore(f);
  const entry = { serial: 1234, name: "Chest", addedAt: "2026-01-01T00:00:00.000Z" };
  assert.deepEqual(store.read(), []);
  writeFileSync(f, padded([entry], 256 * 1024));
  assert.deepEqual(store.read(), [entry]);
  writeFileSync(f, padded([entry], 256 * 1024 + 1));
  assert.deepEqual(store.read(), []);
  assert.ok(existsSync(f), "never moved aside");
  writeFileSync(f, "{oops");
  assert.deepEqual(store.read(), []);
  writeFileSync(f, JSON.stringify([entry, { serial: 0, name: "x", addedAt: "y" }, { ...entry, serial: 5, where: "Home", extra: 1 }]));
  assert.deepEqual(store.read(), [entry, { ...entry, serial: 5, where: "Home" }]);
  store.write([entry]);
  assert.equal(readFileSync(f, "utf8"), "[\n {\n  \"serial\": 1234,\n  \"name\": \"Chest\",\n  \"addedAt\": \"2026-01-01T00:00:00.000Z\"\n }\n]\n");
});

test("[fast] stores: item-kinds reads up to MAX_KINDS_BYTES, moves a larger or damaged file aside with a warning, and writes kindsText", (t) => {
  const d = dir(), f = join(d, "item-kinds.json"), store = createItemKindsStore(f), warned = warnings(t);
  assert.equal(store.file, f);
  assert.deepEqual(store.read(), emptyKindOverrides());
  const doc = { version: 1, names: { "black pearl": "gem" }, graphics: {} };
  writeFileSync(f, padded(doc, MAX_KINDS_BYTES));
  assert.deepEqual(store.read().names, doc.names);
  writeFileSync(f, padded(doc, MAX_KINDS_BYTES + 1));
  assert.deepEqual(store.read(), emptyKindOverrides());
  assert.ok(!existsSync(f) && existsSync(`${f}.corrupt`));
  writeFileSync(f, "{oops");
  assert.deepEqual(store.read(), emptyKindOverrides());
  assert.deepEqual(warned().slice(0, 1), [`item-kinds.json was ignored (it is over ${MAX_KINDS_BYTES / 1e6} MB); it was moved to item-kinds.json.corrupt`]);
  assert.match(warned()[1]!, /^item-kinds\.json was ignored \(invalid JSON: syntax error at position 1\); it was moved to item-kinds\.json\.corrupt-\d+$/);
  const next = { names: { "black pearl": "gem" }, graphics: {} };
  assert.equal(store.save(next), null);
  assert.equal(readFileSync(f, "utf8"), kindsText(next));
});

test("[fast] stores: organize reads up to MAX_SETUP_BYTES, moves a larger, damaged or non-version-1 file aside with a problem, and writes indent 2 with a newline", () => {
  const d = dir(), f = join(d, "organize.json"), store = createOrganizeStore(f);
  assert.deepEqual(store.read(), { config: emptyOrganizeConfig(), problems: [] });
  writeFileSync(f, padded(emptyOrganizeConfig(), MAX_SETUP_BYTES));
  assert.deepEqual(store.read(), { config: emptyOrganizeConfig(), problems: [] });
  assert.ok(existsSync(f));
  writeFileSync(f, padded(emptyOrganizeConfig(), MAX_SETUP_BYTES + 1));
  assert.deepEqual(store.read().problems, [`organize.json is over ${MAX_SETUP_BYTES / 1e6} MB; it was moved to organize.json.corrupt and Organize starts empty`]);
  writeFileSync(f, JSON.stringify({ version: 2 }));
  assert.match(store.read().problems[0]!, /^organize\.json is not a version 1 Organize setup; it was moved to organize\.json\.corrupt-\d+ and Organize starts empty$/);
  writeFileSync(f, "{oops");
  assert.match(store.read().problems[0]!, /^organize\.json did not parse \(invalid JSON: syntax error at position 1\); it was moved to organize\.json\.corrupt-\d+ and Organize starts empty$/);
  store.write(emptyOrganizeConfig());
  assert.equal(readFileSync(f, "utf8"), JSON.stringify(emptyOrganizeConfig(), null, 2) + "\n");
});

test("[fast] stores: organize-state reads up to 4 MB, a larger, missing or damaged file as empty without moving it, and writes indent 1 with a newline", () => {
  const d = dir(), f = join(d, "organize-state.json"), store = createOrganizeStateStore(f);
  assert.equal(store.file, f);
  assert.deepEqual(store.read(), emptyOrganizeState());
  const state = { ...emptyOrganizeState(), seen: { "1234": "2026-01-01T00:00:00.000Z" } };
  writeFileSync(f, padded(state, 4e6));
  assert.deepEqual(store.read(), state);
  writeFileSync(f, padded(state, 4e6 + 1));
  assert.deepEqual(store.read(), emptyOrganizeState());
  writeFileSync(f, "{oops");
  assert.deepEqual(store.read(), emptyOrganizeState());
  assert.ok(existsSync(f), "never moved aside");
  store.write(state);
  assert.equal(readFileSync(f, "utf8"), JSON.stringify(state, null, 1) + "\n");
});

test("[fast] stores: runs writes compact with no newline, lists newest first skipping a damaged file with a console line, and reads a damaged one as null", (t) => {
  const d = dir(), store = createRunsStore(join(d, "runs")), errors = warnings(t, "error");
  assert.deepEqual(store.files(), []);
  const older = { id: "a", createdAt: "2026-01-01T00:00:00.000Z", settings: {} }, newer = { id: "b", createdAt: "2026-02-01T00:00:00.000Z", settings: {} };
  store.write(older);
  store.write(newer);
  assert.equal(readFileSync(join(d, "runs", "a.json"), "utf8"), JSON.stringify(older));
  writeFileSync(join(d, "runs", "c.json"), "{oops");
  assert.deepEqual(store.all().map((r) => r.id), ["b", "a"]);
  assert.deepEqual(errors().map((e) => e.replace(/: .*/, ":")), ["skipping run c.json:"]);
  assert.equal(store.read("c"), null);
  assert.ok(store.has("c"));
  store.write({ ...older, label: "x" } as typeof older, "c");
  assert.equal(readFileSync(join(d, "runs", "c.json"), "utf8"), JSON.stringify({ ...older, label: "x" }), "written under the id it was asked for");
  store.remove("c");
  assert.ok(!store.has("c"));
});

test("[fast] stores: scans skips a damaged file with a warning, reads a valid one, and signs the folder by name, mtime and size", (t) => {
  const d = dir(), scans = join(d, "scans"), store = createScansStore({ dir: scans, shard: () => DEFAULT_SHARD }), warned = warnings(t);
  assert.deepEqual(store.files(), []);
  assert.equal(store.signature(), "no-scans-dir");
  mkdirSync(scans);
  copyFileSync(join(APP, "fixtures", "demo-Kestrel.json"), join(scans, "kestrel.json"));
  writeFileSync(join(scans, "bad.json"), "{oops");
  writeFileSync(join(scans, "notes.txt"), "not a scan");
  assert.deepEqual(store.files().map((s) => s.file), ["kestrel.json"]);
  assert.deepEqual(warned().map((w) => w.replace(/: .*/, ":")), ["skipping bad.json:"]);
  assert.match(store.signature(), /^bad\.json:[\d.]+:5\|kestrel\.json:[\d.]+:\d+$/);
});
