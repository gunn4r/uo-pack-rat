import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout, corePath } from "./config.mts";

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
// Phase 6 final review follow-up: the bridge became per-adapter (bridgeFor/bridgeQueueFor/
// bridgeStatusFor), mirroring inboxFor — bridge/bridgeQueue/bridgeStatus (above) must still be
// exactly bridgeFor("tazuo")'s own paths, so an existing TazUO player's data directory needs no
// migration: the fixed key and the per-adapter resolver produce byte-identical paths for "tazuo".
test("[smoke] config: bridgeFor/bridgeQueueFor/bridgeStatusFor are per-adapter, and bridgeFor(\"tazuo\") equals the legacy fixed bridge path", () => {
  const c = resolveConfig([], {}, "/home/x");
  assert.equal(c.paths.bridgeFor("tazuo"), c.paths.bridge, "no migration for an existing TazUO player: same path either way");
  assert.equal(c.paths.bridgeQueueFor("tazuo"), c.paths.bridgeQueue);
  assert.equal(c.paths.bridgeStatusFor("tazuo"), c.paths.bridgeStatus);
  assert.equal(c.paths.bridgeFor("razor-enhanced"), join(c.dataDir, "bridge", "razor-enhanced"));
  assert.equal(c.paths.bridgeQueueFor("razor-enhanced"), join(c.dataDir, "bridge", "razor-enhanced", "queue.jsonl"));
  assert.equal(c.paths.bridgeStatusFor("razor-enhanced"), join(c.dataDir, "bridge", "razor-enhanced", "status.json"));
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
  const { ensureLayout } = await import("./config.mts");
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
test("[smoke] config: a value-taking flag with no value (last, or followed by another flag) throws", () => {
  assert.throws(() => resolveConfig(["--data", "--demo"], {}, "/h"), /--data needs a value/);
  assert.throws(() => resolveConfig(["--demo", "--data"], {}, "/h"), /--data needs a value/);
  assert.throws(() => resolveConfig(["--port", "--open"], {}, "/h"), /--port needs a value/);
});
test("[smoke] config: paths.core defaults to the source module under scripts/, PACKRAT_CORE wins", () => {
  const c = resolveConfig([], {}, "/h");
  assert.ok(c.paths.core.endsWith(join("scripts", "optimizer-core.mts")));
  assert.equal(resolveConfig([], { PACKRAT_CORE: "/x/core.mjs" }, "/h").paths.core, resolve("/x/core.mjs"));
});
test("[smoke] config: corePath resolves the same way paths.core does, callable before a full config exists", () => {
  assert.ok(corePath({}).endsWith(join("scripts", "optimizer-core.mts")), "no PACKRAT_CORE: the source module under scripts/");
  assert.equal(corePath({ PACKRAT_CORE: "/x/core.mjs" }), resolve("/x/core.mjs"), "PACKRAT_CORE overrides, resolved against cwd");
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

// Phase 7 security review, Minor 12: the data directory and every file in it were created at the
// process umask's default (0755/0644), so on a shared machine another local account could read
// <data>/scans/, settings.json (which names the player's game-client folder) and logs/server.log.
// PRIVACY.md's promise is that this data never leaves the machine; the modes should not be looser
// than that intent. Windows has no POSIX mode bits, so the assertion is POSIX-only — the mode option
// itself is a harmless no-op there.
test("[smoke] config: ensureLayout creates the data dir 0700 and settings.json 0600", { skip: process.platform === "win32" ? "POSIX modes only" : false }, () => {
  // A SUBDIRECTORY of the temp dir, not the temp dir itself: mkdtempSync already forces 0700 on what
  // it creates, so testing that would prove nothing about ensureLayout.
  const dataDir = join(mkdtempSync(join(tmpdir(), "qm-modes-")), "pack-rat");
  const c = ensureLayout(resolveConfig(["--data", dataDir], {}));
  assert.equal(statSync(c.dataDir).mode & 0o777, 0o700);
  assert.equal(statSync(c.paths.runs).mode & 0o777, 0o700);
  assert.equal(statSync(c.paths.scans).mode & 0o777, 0o700);
  assert.equal(statSync(c.paths.logs).mode & 0o777, 0o700);
  assert.equal(statSync(c.paths.settings).mode & 0o777, 0o600);
});
