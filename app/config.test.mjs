import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { resolveConfig, ensureLayout } from "./config.mjs";

test("[smoke] config: defaults to ~/.pack-rat and port 8765", () => {
  const c = resolveConfig([], {}, "/home/x");
  assert.equal(c.dataDir, resolve(join("/home/x", ".pack-rat")));
  assert.equal(c.port, 8765);
  assert.equal(c.demo, false);
  assert.equal(c.open, false);
  assert.equal(c.paths.scans, join(c.dataDir, "scans"));
  assert.equal(c.paths.profiles, join(c.dataDir, "profiles.json"));
  assert.equal(c.paths.settings, join(c.dataDir, "settings.json"));
  assert.equal(c.paths.rules, join(c.dataDir, "rules"));
  assert.equal(c.paths.runs, join(c.dataDir, "runs"));
  assert.equal(c.paths.bridgeQueue, join(c.dataDir, "bridge", "tazuo", "queue.jsonl"));
  assert.equal(c.paths.inbox, join(c.dataDir, "inbox"));
  assert.equal(c.paths.inboxFor("tazuo"), join(c.dataDir, "inbox", "tazuo"));
});
test("[smoke] config: ensureLayout creates the tazuo inbox directory", async () => {
  const { mkdtempSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "qm-cfg-inbox-"));
  const c = ensureLayout(resolveConfig(["--data", dir], {}));
  assert.ok(existsSync(c.paths.inboxFor("tazuo")));
});
test("[smoke] config: ensureLayout writes a default settings.json (shard uoalive) if none exists", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { ensureLayout } = await import("./config.mjs");
  const { readFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "qm-cfg-"));
  const c = ensureLayout(resolveConfig(["--data", dir], {}));
  const settings = JSON.parse(readFileSync(c.paths.settings, "utf8"));
  assert.equal(settings.shard, "uoalive");
  assert.equal(settings.schemaVersion, 1);
});
test("[smoke] config: --data beats PACKRAT_DATA beats home; --port beats PACKRAT_PORT", () => {
  assert.equal(resolveConfig([], { PACKRAT_DATA: "/env" }, "/h").dataDir, resolve("/env"));
  assert.equal(resolveConfig(["--data", "/flag"], { PACKRAT_DATA: "/env" }, "/h").dataDir, resolve("/flag"));
  assert.equal(resolveConfig(["--port", "9000"], { PACKRAT_PORT: "8000" }, "/h").port, 9000);
  assert.equal(resolveConfig([], { PACKRAT_PORT: "8000" }, "/h").port, 8000);
});
test("[smoke] config: --demo points scans at app/fixtures, --open sets open", () => {
  const c = resolveConfig(["--demo", "--open"], {}, "/h");
  assert.ok(c.demo && c.open);
  assert.ok(c.paths.scans.endsWith(join("app", "fixtures")));
  assert.equal(c.paths.profiles, join(c.dataDir, "profiles.json"));   // demo changes scans only
});
test("[smoke] config: a non-numeric --port throws with a message naming the bad value", () => {
  assert.throws(() => resolveConfig(["--port", "abc"], {}, "/h"), /invalid port/);
});
test("[smoke] config: paths.core defaults under app/dist, PACKRAT_CORE wins", () => {
  const c = resolveConfig([], {}, "/h");
  assert.ok(c.paths.core.endsWith(join("app", "dist", "optimizer-core.mjs")));
  assert.equal(resolveConfig([], { PACKRAT_CORE: "/x/core.mjs" }, "/h").paths.core, resolve("/x/core.mjs"));
});
test("[smoke] config: token defaults to null; --token beats PACKRAT_TOKEN; paths.log sits under paths.logs", () => {
  const c = resolveConfig([], {}, "/h");
  assert.equal(c.token, null);
  assert.equal(c.paths.log, join(c.paths.logs, "server.log"));
  assert.equal(resolveConfig([], { PACKRAT_TOKEN: "envtok" }, "/h").token, "envtok");
  assert.equal(resolveConfig(["--token", "flagtok"], { PACKRAT_TOKEN: "envtok" }, "/h").token, "flagtok");
});
test("[smoke] config: paths.adaptersDir defaults to the repo's adapters/ folder, --adapters beats PACKRAT_ADAPTERS_DIR", () => {
  const c = resolveConfig([], {}, "/h");
  assert.ok(c.paths.adaptersDir.endsWith("adapters"), c.paths.adaptersDir);
  assert.equal(resolveConfig([], { PACKRAT_ADAPTERS_DIR: "/env-adapters" }, "/h").paths.adaptersDir, resolve("/env-adapters"));
  assert.equal(resolveConfig(["--adapters", "/flag-adapters"], { PACKRAT_ADAPTERS_DIR: "/env-adapters" }, "/h").paths.adaptersDir, resolve("/flag-adapters"));
});
