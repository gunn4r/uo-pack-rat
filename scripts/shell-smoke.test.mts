// shell-smoke.test.mts — proves the packaged Electron shell (electron/main.mts +
// electron/server-entry.mts) actually boots: forks the server, loads the page over the token-bearing
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
function resolveElectronBin(): string | null {
  // Outside a real Electron process, requiring the "electron" package resolves to the path of the
  // native binary rather than the API surface `import { app } from "electron"` sees — a documented
  // quirk of how that package's own entrypoint decides what to export, not something this file can
  // narrow with a runtime check.
  try { return require("electron") as string; } catch { return null; }   // not installed at all
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

interface SmokeResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runSmoke(dataDir: string): Promise<SmokeResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PACKRAT_DATA: dataDir };
    delete env.ELECTRON_ENABLE_LOGGING;
    // node:test only runs this function's caller when SKIP is falsy, and SKIP is falsy only when
    // ELECTRON_BIN resolved successfully above — so ELECTRON_BIN is never null here, the same
    // caller-guarantees-it invariant app/optimize-worker.mts names for its own parentPort.
    const child = spawn(ELECTRON_BIN!, [ROOT, "--smoke", "--demo", "--data", dataDir], {
      cwd: ROOT,
      env,
    });
    let stdout = "", stderr = "";
    // spawn() here passes no `stdio` option, so it keeps Node's default of piping all three streams —
    // stdout/stderr are only `| null` in the type for the configurations that turn piping off.
    child.stdout!.on("data", (b) => { stdout += b.toString(); });
    child.stderr!.on("data", (b) => { stderr += b.toString(); });
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
