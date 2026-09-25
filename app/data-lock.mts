// data-lock.mts — one Pack Rat per data folder. Two servers on one folder race each other's writes (the
// accepted-scan idempotency check among them, issue #28), so the desktop shell and `scripts/start.mts` each
// take <dataDir>/packrat.lock before starting one. Electron's own single-instance lock only stops a second
// desktop app; this one also covers a desktop app and a browser-mode server, or two browser-mode servers.
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";

const bootedAt = (): number => Date.now() - uptime() * 1000;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

// Takes the lock for this process and releases it on exit, or returns the pid of the live process holding
// it. A lock whose process is gone, or that was written before the last reboot (its pid may belong to
// something else by now), is stale and taken over. The lock is written in full to a temporary file and
// hard-linked into place, so a reader never sees half of one.
export function acquireDataLock(dataDir: string): { release: () => void } | { heldBy: number } {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "packrat.lock"), tmp = `${path}.${process.pid}`;
  const fd = openSync(tmp, "w", 0o600);
  writeSync(fd, JSON.stringify({ pid: process.pid, bootedAt: bootedAt() }));
  closeSync(fd);
  try {
    for (let tries = 0; ; tries++) {
      try {
        linkSync(tmp, path);
        const release = (): void => { try { if (JSON.parse(readFileSync(path, "utf8")).pid === process.pid) unlinkSync(path); } catch { /* already gone */ } };
        process.once("exit", release);
        return { release };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || tries === 2) throw e;
      }
      let held: { pid?: unknown; bootedAt?: unknown } = {};
      try { held = JSON.parse(readFileSync(path, "utf8")); } catch { /* unreadable: stale */ }
      if (typeof held.pid === "number" && held.pid !== process.pid && Math.abs(Number(held.bootedAt) - bootedAt()) < 60_000 && alive(held.pid)) return { heldBy: held.pid };
      try { unlinkSync(path); } catch { /* another process took it over first; the next link says so */ }
    }
  } finally {
    unlinkSync(tmp);
  }
}
