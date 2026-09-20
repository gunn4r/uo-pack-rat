import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUi } from "./build-ui.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Builds into the REAL app/dist (not a temp copy) — other test files (app/server.test.mjs among
// them) read app/dist later in the same run, and the runner drives everything at concurrency: 1,
// so leaving the real build in place is required, not just convenient. buildUi() always recompiles
// (no freshness check of its own), so this is safe to run alongside those other buildUi() callers.
test("[fast] buildUi compiles the page into app/dist/ui, with extensions rewritten and no stray .css", () => {
  buildUi();
  const appOut = join(ROOT, "app", "dist", "ui", "app.mjs");
  const shardOut = join(ROOT, "app", "dist", "ui", "shard.mjs");
  assert.ok(existsSync(appOut), "app/dist/ui/app.mjs was not produced");
  assert.ok(existsSync(shardOut), "app/dist/ui/shard.mjs was not produced");
  const appJs = readFileSync(appOut, "utf8");
  assert.ok(appJs.includes("./shard.mjs"), "app.mjs should import shard.mjs by its compiled extension");
  assert.ok(!appJs.includes("./shard.mts"), "app.mjs must not still reference the .mts source extension");
  assert.ok(!existsSync(join(ROOT, "app", "dist", "ui", "styles.css")), "tsc must not emit a .css file — the source tree's copy is served directly");
});
