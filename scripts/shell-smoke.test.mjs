// shell-smoke.test.mjs — proves the packaged Electron shell (electron/main.mjs +
// electron/server-entry.mjs) actually boots: forks the server, loads the page over the token-bearing
// local server, and exits clean. `[slow]` — it launches a real Electron binary, tens of seconds even
// when everything works. Skipped when electron isn't installed (a plain `npm test` clone/CI box) or
// when TEST_SKIP_ELECTRON=1 is set, same shape as TEST_SKIP_SLOW for the other `[slow]` cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// require("electron"), run from plain Node (not inside Electron itself), resolves to the path of the
// native Electron binary for whatever platform npm installed — the portable alternative to guessing
// node_modules/.bin/electron vs electron.cmd (post-review fix, Minor 11: spawning the .bin shim with
// no shell hit ENOENT on win32, where it's a .cmd wrapper the OS won't exec directly).
const require = createRequire(import.meta.url);
function resolveElectronBin() {
  try { return require("electron"); } catch { return null; }   // not installed at all
}
const ELECTRON_BIN = resolveElectronBin();
const SKIP = !ELECTRON_BIN || process.env.TEST_SKIP_ELECTRON === "1"
  ? (process.env.TEST_SKIP_ELECTRON === "1" ? "TEST_SKIP_ELECTRON" : "electron is not installed (npm i -D electron)")
  : false;

test("[slow] the Electron shell boots, loads the page and exits clean (--smoke)", { skip: SKIP }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "qm-shell-smoke-"));
  try {
    const { code, stdout } = await runSmoke(dataDir);
    assert.equal(code, 0, `expected exit 0, got ${code}\nstdout:\n${stdout}`);
    assert.match(stdout, /SMOKE OK \d+/, `expected "SMOKE OK <port>" in stdout\nstdout:\n${stdout}`);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function runSmoke(dataDir) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PACKRAT_DATA: dataDir };
    delete env.ELECTRON_ENABLE_LOGGING;
    const child = spawn(ELECTRON_BIN, [ROOT, "--smoke", "--demo", "--data", dataDir], {
      cwd: ROOT,
      env,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`electron --smoke did not exit within 60s\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 60000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
