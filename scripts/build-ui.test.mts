import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUi, tscSpawnEnv } from "./build-ui.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Builds into the REAL app/dist (not a temp copy) — other test files (app/server.test.mts among
// them) read app/dist later in the same run, and the runner drives everything at concurrency: 1,
// so leaving the real build in place is required, not just convenient. buildUi() always recompiles
// (no freshness check of its own), so this is safe to run alongside those other buildUi() callers.
test("[fast] buildUi compiles the page into app/dist/ui, with extensions rewritten and no stray .css", () => {
  buildUi();
  const appOut = join(ROOT, "app", "dist", "ui", "app.mjs");
  const shellOut = join(ROOT, "app", "dist", "ui", "shell.mjs");
  assert.ok(existsSync(appOut), "app/dist/ui/app.mjs was not produced");
  assert.ok(existsSync(shellOut), "app/dist/ui/shell.mjs was not produced");
  const appJs = readFileSync(appOut, "utf8");
  assert.ok(appJs.includes("./shell.mjs"), "app.mjs should import shell.mjs by its compiled extension");
  assert.ok(!appJs.includes("./shell.mts"), "app.mjs must not still reference the .mts source extension");
  for (const css of ["tokens.css", "components.css", "styles.css"]) assert.ok(!existsSync(join(ROOT, "app", "dist", "ui", css)), `tsc must not emit ${css} — the source tree's copy is served directly`);
});

test("[fast] the tsc child runs as plain Node when buildUi is called from Electron's main process", () => {
  const env = { PATH: "x" };
  assert.equal(tscSpawnEnv({ ...process.versions, electron: "44.4.1" }, env).ELECTRON_RUN_AS_NODE, "1");
  assert.equal(tscSpawnEnv({ ...process.versions, electron: "44.4.1" }, env).PATH, "x");
  const { electron: _electron, ...plainNode } = process.versions;
  assert.equal(tscSpawnEnv(plainNode as NodeJS.ProcessVersions, env), env);
});
