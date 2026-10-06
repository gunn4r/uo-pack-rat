// setup.test.mts — `app/services/setup.mts` on its own, over copies of the repo's adapters.
//
// `app/services/setup.mts` over copies of the repo's adapters: the shipped ids, an adapter folder added at run time seen at once, what each manifest says its bridge can do, and the data-folder check (none under `--demo`, candidates asked only with no client set). All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createSetupService } from "./setup.mts";

const ADAPTERS = fileURLToPath(new URL("../../adapters/", import.meta.url));

test("[fast] setup service: the shipped ids, what each manifest says its bridge can do, and an adapter folder added at run time", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-setup-"));
  cpSync(join(ADAPTERS, "classicuo-web"), join(dir, "classicuo-web"), { recursive: true });
  const service = createSetupService({ adaptersDir: dir, dataDir: dir, demo: false, clientSearch: { home: dir, candidates: () => [] } });
  assert.deepEqual(service.adapters().map((a) => a.id), ["classicuo-web"]);
  assert.equal(service.isKnown("tazuo"), false);
  cpSync(join(ADAPTERS, "tazuo"), join(dir, "tazuo"), { recursive: true });
  assert.equal(service.isKnown("tazuo"), true, "read from disk on every call");
  assert.equal(service.isKnown(7), false);
  assert.deepEqual(service.manifest("tazuo")?.capabilities?.bridge, ["highlight", "grab", "goto", "trip", "trip-bags"]);
  assert.deepEqual(service.manifest("tazuo")?.features, []);
  assert.deepEqual(service.manifest("classicuo-web")?.capabilities?.bridge, []);
  assert.equal(service.manifest("ghost"), null);
});

test("[fast] setup service: the data-folder check is none under --demo, and asks for candidates only with no client set", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-setup-"));
  const asked: string[] = [];
  const clientSearch = { home: dir, candidates: (a: { id: string }) => { asked.push(a.id); return []; } };
  assert.deepEqual(createSetupService({ adaptersDir: ADAPTERS, dataDir: dir, demo: true, clientSearch }).dataDirCheck(null), { status: "none" });
  const service = createSetupService({ adaptersDir: ADAPTERS, dataDir: dir, demo: false, clientSearch });
  service.dataDirCheck({ adapter: "tazuo", scriptsDir: dir });
  assert.deepEqual(asked, []);
  service.dataDirCheck(null);
  assert.deepEqual(asked.sort(), ["classicuo-web", "razor-enhanced", "tazuo"]);
});
