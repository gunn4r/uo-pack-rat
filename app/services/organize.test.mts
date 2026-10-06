// organize.test.mts — app/services/organize.mts on its own: with nothing pending a harvest only reads the state file (no write, no event); the saved suits are read only when a rule asks to skip them; a Put away request file is removed and always answered. The Organize routes themselves are app/organize-server.test.mts. Tags: [fast]. Run: node --test app/services/organize.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig } from "../config.mts";
import { emptyOrganizeConfig } from "../organize-config.mts";
import { emptyOrganizeState } from "../organize-state.mts";
import { loadRules } from "../rules.mts";
import { createOrganizeService } from "./organize.mts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pr-organize-svc-")), paths = resolveConfig(["--data", dir], {}).paths;
  let stateReads = 0, stateWrites = 0, runReads = 0;
  const events: string[] = [], logged: string[] = [];
  const service = createOrganizeService({
    paths, getInventory: async () => { throw new Error("not planned"); },
    organizeStore: { read: () => ({ config: emptyOrganizeConfig(), problems: [] }) },
    organizeStateStore: { read: () => { stateReads++; return emptyOrganizeState(); }, write: () => { stateWrites++; } },
    blacklistStore: { read: () => [] }, runStore: { all: () => { runReads++; return []; } },
    rules: () => loadRules("uoalive"), runsTrips: () => false, events: { broadcast: (e) => events.push(e) }, log: (line) => logged.push(line),
  });
  return { dir, paths, service, events, logged, counts: () => ({ stateReads, stateWrites, runReads }) };
}

test("[fast] organize service: with nothing pending a harvest only reads the state file", () => {
  const t = setup();
  const { state, bridges } = t.service.harvestNow(Date.now());
  assert.deepEqual(state, emptyOrganizeState());
  assert.deepEqual(bridges, {});
  assert.deepEqual(t.counts(), { stateReads: 1, stateWrites: 0, runReads: 0 });
  assert.deepEqual(t.events, []);
});

test("[fast] organize service: the saved suits are read only when a rule skips them", () => {
  const t = setup();
  assert.equal(t.service.suitsFor([{ query: {} } as never]), undefined);
  assert.equal(t.counts().runReads, 0);
  assert.deepEqual(t.service.suitsFor([{ query: {}, skipSuits: true } as never]), new Set());
  assert.equal(t.counts().runReads, 1);
});

test("[fast] organize service: a Put away request file is removed and answered in putaway.json, here with a refusal", async () => {
  const t = setup();
  const request = join(t.dir, "putaway-request.json");
  writeFileSync(request, JSON.stringify({ id: "r1" }));
  await t.service.putAway("tazuo", request);
  assert.equal(existsSync(request), false);
  const reply = JSON.parse(readFileSync(join(t.paths.bridgeFor("tazuo"), "putaway.json"), "utf8")) as Record<string, unknown>;
  assert.equal(reply.ok, false);
  assert.ok(typeof reply.msg === "string" && reply.msg.length > 0);
  assert.deepEqual(t.logged, []);
});
