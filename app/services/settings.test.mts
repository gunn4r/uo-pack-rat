// settings.test.mts — `app/services/settings.mts` on its own: fallbacks kept in memory, saves that write only their own fields, and a shard switch.
//
// `app/services/settings.mts`: an unknown client adapter and a shard that does not load dropped in memory only with their warnings, a save writing only its own fields (a fallback never persisted, a new client clearing the ignored one), a shard switch handing its rules to vault-lib, a rules file still carrying the old `resistSkillBonus` (issue #261) warned about at load and on a switch, the bridge adapter's tazuo default. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSettingsStore } from "../store/settings.mts";
import { loadRules, DEFAULT_SHARD } from "../rules.mts";
import { getRules, rulesUpgradeNote } from "../vault-lib.mts";
import { createSettingsService } from "./settings.mts";

function serve(doc: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "pr-settings-")), file = join(dir, "settings.json"), warned: string[] = [];
  writeFileSync(file, JSON.stringify(doc));
  const service = createSettingsService({ store: createSettingsStore({ file, warn: (m) => warned.push(m) }), rulesDir: join(dir, "rules"), isKnownAdapter: (id) => id === "tazuo", warn: (m) => warned.push(m) });
  return { service, file, warned, onDisk: () => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown> };
}

test("[fast] settings service: an unknown client is ignored in memory, kept on disk through an unrelated save, and replaced by a new one", () => {
  const ghost = { adapter: "ghost", scriptsDir: "/x" };
  const t = serve({ schemaVersion: 1, shard: DEFAULT_SHARD, client: ghost });
  assert.equal(t.service.current().client, null);
  assert.deepEqual(t.service.saved().client, ghost);
  assert.deepEqual(t.warned, [`settings.json names a client adapter this install does not ship ("ghost"); ignoring that client for this run — settings.json is unchanged`]);
  assert.equal(t.service.bridgeAdapter(), "tazuo");
  t.service.save({ setupDone: true });
  assert.deepEqual(t.onDisk(), { schemaVersion: 1, shard: DEFAULT_SHARD, client: ghost, setupDone: true });
  assert.equal(t.service.current().client, null);
  const real = { adapter: "razor-enhanced", scriptsDir: "/y" };
  t.service.save({ client: real });
  assert.deepEqual(t.service.current().client, real);
  assert.equal(t.service.bridgeAdapter(), "razor-enhanced");
});

test("[fast] settings service: a shard that does not load falls back in memory, and a shard switch hands its rules to vault-lib", () => {
  const t = serve({ schemaVersion: 1, shard: "no-such-shard" });
  assert.equal(t.service.rulesFallback(), true);
  assert.equal(t.service.current().shard, DEFAULT_SHARD);
  assert.equal(t.service.saved().shard, "no-such-shard");
  assert.match(t.warned[0]!, /^settings\.json names shard "no-such-shard", which failed to load \(.*\); falling back to "uoalive" for this run — settings\.json is unchanged$/);
  assert.equal(getRules(), t.service.rules());
  t.service.save({ autoUpdateCheck: false });
  assert.equal(t.onDisk().shard, "no-such-shard", "the fallback is never written");
  const rules = loadRules(DEFAULT_SHARD);
  t.service.save({ shard: DEFAULT_SHARD });
  t.service.applyRules(rules, false);
  assert.equal(t.service.rulesFallback(), false);
  assert.equal(t.service.rules(), rules);
  assert.equal(getRules(), rules);
  assert.equal(t.service.current().autoUpdateCheck, false);
  assert.deepEqual(t.service.current().retention, { keepAll: false, scanDays: 30, runsPerCharacter: 50 });
});

// Issue #261: a rules file written for the old additive model validates (extra keys are allowed) but gives no
// minimum, so the server says what to change, at startup and on a switch to it; the page shows the same note.
test("[fast] settings service: a rules file still carrying resistSkillBonus is warned about, at load and on a switch", () => {
  const { resistMinimum: _m, ...old } = { ...loadRules(DEFAULT_SHARD), id: "oldshard", name: "Old Shard", resistSkillBonus: { breakpoints: [[100, 0.4], [120, 0.2]] } };
  const note = rulesUpgradeNote(old)!;
  assert.match(note, /^The "Old Shard" rules file still has "resistSkillBonus", which Pack Rat no longer reads/);
  assert.equal(rulesUpgradeNote(loadRules(DEFAULT_SHARD)), null);
  assert.equal(rulesUpgradeNote({ ...old, resistMinimum: { kind: "servuo" } }), null, "both: the minimum is there");
  const dir = mkdtempSync(join(tmpdir(), "pr-settings-")), file = join(dir, "settings.json"), rulesDir = join(dir, "rules"), warned: string[] = [];
  mkdirSync(rulesDir);
  writeFileSync(join(rulesDir, "oldshard.json"), JSON.stringify(old));
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, shard: "oldshard" }));
  const service = createSettingsService({ store: createSettingsStore({ file, warn: (m) => warned.push(m) }), rulesDir, isKnownAdapter: () => true, warn: (m) => warned.push(m) });
  assert.deepEqual(warned, [note], "at startup");
  service.applyRules(loadRules(DEFAULT_SHARD), false);
  assert.deepEqual(warned, [note], "a current rules file: nothing more");
  service.applyRules(loadRules("oldshard", { userRulesDir: rulesDir }), false);
  assert.deepEqual(warned, [note, note], "on a switch to it");
  service.applyRules(loadRules(DEFAULT_SHARD), false);
});
