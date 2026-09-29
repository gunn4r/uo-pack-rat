import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildUi, tscSpawnEnv } from "./build-ui.mts";

// Builds into a temp folder, not the real app/dist: other test files run alongside this one and serve
// the page the runner built there.
test("[fast] buildUi compiles the page into its output folder, with extensions rewritten and no stray .css", () => {
  const out = mkdtempSync(join(tmpdir(), "packrat-build-ui-"));
  try {
    const stale = join(out, "ui", "deleted-source.mjs");   // the output of an app/ui file since removed
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "");
    assert.equal(buildUi({ outDir: out }), join(out, "ui", "app.mjs"));
    assert.ok(!existsSync(stale), "an output whose source is gone must not survive a build");
    const appOut = join(out, "ui", "app.mjs");
    const shellOut = join(out, "ui", "shell.mjs");
    assert.ok(existsSync(appOut), "ui/app.mjs was not produced");
    assert.ok(existsSync(shellOut), "ui/shell.mjs was not produced");
    const appJs = readFileSync(appOut, "utf8");
    assert.ok(appJs.includes("./shell.mjs"), "app.mjs should import shell.mjs by its compiled extension");
    assert.ok(!appJs.includes("./shell.mts"), "app.mjs must not still reference the .mts source extension");
    for (const css of ["tokens.css", "components.css", "styles.css"]) assert.ok(!existsSync(join(out, "ui", css)), `tsc must not emit ${css} — the source tree's copy is served directly`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("[fast] with PACKRAT_UI_BUILT=1 (set by the runner once it has built) buildUi leaves app/dist alone", () => {
  const saved = process.env.PACKRAT_UI_BUILT;
  process.env.PACKRAT_UI_BUILT = "1";
  try {
    const entry = buildUi();   // builds only when there is no page yet (a bare `node --test` on a fresh clone)
    const before = statSync(entry).mtimeMs;
    assert.equal(buildUi(), entry);
    assert.equal(statSync(entry).mtimeMs, before, "app/dist was rebuilt");
  } finally {
    if (saved === undefined) delete process.env.PACKRAT_UI_BUILT; else process.env.PACKRAT_UI_BUILT = saved;
  }
});

test("[fast] the tsc child runs as plain Node when buildUi is called from Electron's main process", () => {
  const env = { PATH: "x" };
  assert.equal(tscSpawnEnv({ ...process.versions, electron: "44.4.1" }, env).ELECTRON_RUN_AS_NODE, "1");
  assert.equal(tscSpawnEnv({ ...process.versions, electron: "44.4.1" }, env).PATH, "x");
  const { electron: _electron, ...plainNode } = process.versions;
  assert.equal(tscSpawnEnv(plainNode as NodeJS.ProcessVersions, env), env);
});
