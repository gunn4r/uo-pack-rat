// start.test.mts — scripts/start.mts (`npm start`), run as a real child process against a temp data
// directory on port 0. It is a thin wrapper around the server, and the two things it can get wrong
// are both about how it ends: a signal sent to it must reach the server rather than leave it running
// and holding the port, and a server that dies from a signal must not read as a clean exit 0. `[fast]`:
// one page build and one server start, a few seconds. Skipped on Windows, which has no POSIX signals
// to forward (process.kill there terminates the target outright).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("[fast] a SIGTERM to npm start stops the server too, and the exit is not reported as success", { skip: process.platform === "win32" ? "no POSIX signals on Windows" : false, timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "packrat-start-"));
  const start = spawn(process.execPath, [join(ROOT, "scripts", "start.mts"), "--port", "0", "--data", dir], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    let out = "";
    const url = await new Promise<string>((resolve, reject) => {
      start.stdout.on("data", (b: Buffer) => {
        out += b.toString();
        const m = /Pack Rat: (http:\/\/localhost:\d+)/.exec(out);
        if (m) resolve(m[1]!);
      });
      start.on("exit", (code) => reject(new Error(`start.mts exited (${code}) before the server listened: ${out}`)));
    });
    assert.equal((await fetch(`${url}/api/setup`)).status, 200, "the server is up before the signal");
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => start.on("exit", (code, signal) => resolve({ code, signal })));
    start.kill("SIGTERM");
    const { code, signal } = await exited;
    assert.equal(signal, null, "start.mts handles the signal itself, forwards it, and exits once the server has");
    assert.equal(code, 143, "a server killed by SIGTERM exits the wrapper with 128 + 15, not 0");
    await assert.rejects(fetch(`${url}/api/setup`), "nothing may still be listening on the port");
  } finally {
    // An orphaned server (the bug this guards) inherits these pipes; left open, they would keep this
    // file's process alive long after the assertion that caught it.
    start.stdout.destroy();
    start.stderr.destroy();
    start.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
