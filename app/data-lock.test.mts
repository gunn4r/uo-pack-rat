import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireDataLock } from "./data-lock.mts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "packrat-lock-"));
// What a second process gets from acquireDataLock on `dir`: the holder's pid, or "took".
function otherProcess(dir: string): string {
  const src = `import { acquireDataLock } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "data-lock.mts")).href)};
const r = acquireDataLock(${JSON.stringify(dir)}); console.log("heldBy" in r ? r.heldBy : "took");`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", src], { encoding: "utf8" }).stdout.trim();
}
const plant = (dir: string, pid: number, bootedAt = Date.now() - uptime() * 1000): void => writeFileSync(join(dir, "packrat.lock"), JSON.stringify({ pid, bootedAt }));

test("[fast] data lock: a second process is refused while the first holds the folder, and gets it once released", () => {
  const dir = tmp();
  const lock = acquireDataLock(dir);
  assert.ok("release" in lock);
  assert.equal(otherProcess(dir), String(process.pid));
  lock.release();
  assert.equal(existsSync(join(dir, "packrat.lock")), false);
  assert.equal(otherProcess(dir), "took");
  assert.equal(existsSync(join(dir, "packrat.lock")), false, "released when that process exits");
});

test("[fast] data lock: a lock left by a process that is gone, or from before a reboot, is taken over", () => {
  const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
  const dir = tmp();
  plant(dir, dead);
  const a = acquireDataLock(dir);
  assert.ok("release" in a);
  assert.equal(JSON.parse(readFileSync(join(dir, "packrat.lock"), "utf8")).pid, process.pid);
  a.release();
  plant(dir, process.ppid, 0);
  const b = acquireDataLock(dir);
  assert.ok("release" in b, "the pid may belong to another program since the reboot");
  b.release();
  plant(dir, process.ppid);
  assert.deepEqual(acquireDataLock(dir), { heldBy: process.ppid });
});
