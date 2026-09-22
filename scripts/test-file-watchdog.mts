// test-file-watchdog.mts — preloaded into every test file's process by scripts/run-suite.mts
// (`--import <this file>?ms=<grace>`). Once the file's tests have all finished, it gives the process
// `ms` more milliseconds to exit on its own and then ends it, saying why on stderr.
//
// It exists because the two simpler answers each hide something. Waiting for ever lets one leftover
// handle (a test that timed out with an interval still running, a server nobody closed) hang the whole
// run. node:test's own forceExit ends the file the moment its last test returns, which throws away an
// error that fires after that — a timer that throws, a promise rejected without an await — and a
// file like that has to fail. The grace period lets those errors land and still bounds the file.
//
// The timer is unref'd, so a file that exits normally is not held open by it for a moment longer.
import { after } from "node:test";

// run-suite.mts recognises a file this stopped by this exact text on its stderr (it cannot import it:
// loading this module is what registers the hook).
const WATCHDOG_MARKER = "[pack-rat test watchdog]";
const grace = Number(new URL(import.meta.url).searchParams.get("ms")) || 10_000;

after(() => {
  setTimeout(() => {
    process.stderr.write(`${WATCHDOG_MARKER} still running ${grace} ms after its tests finished (an open handle: a timer, a server, a child process); stopped it\n`);
    process.exitCode = 1;
    process.exit();
  }, grace).unref();
});
