#!/usr/bin/env node
// start.mts — start the Pack Rat server (bare, no Electron). Flags pass through to the server.
//   npm start -- --open        npm start -- --demo --port 9000
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../app/config.mts";
import { acquireDataLock } from "../app/data-lock.mts";
import { buildUi } from "./build-ui.mts";
import { buildSchemaTypes } from "./build-schema-types.mts";

// Build the schema types before buildUi() — this call, not tsconfig.browser.json's `include` (a
// missing literal entry there is silently dropped, not an error), is what actually guarantees
// app/schema/types.d.mts exists before anything imports from it. The optimizer core needs no build
// step — every caller imports scripts/optimizer-core.mts straight from source (config.mts's
// corePath()/paths.core; PACKRAT_CORE overrides it).
buildSchemaTypes();
buildUi();
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let port: number, dataDir: string;
try {
  ({ port, dataDir } = resolveConfig(args));
} catch (e) {
  const err = e as { message?: unknown };
  console.error(err.message);
  process.exit(2);
}

const free = await new Promise<boolean>((ok) => { const s = createServer(); s.once("error", () => ok(false)); s.listen(port, "127.0.0.1", () => s.close(() => ok(true))); });
if (!free) { console.error(`port ${port} is in use — stop the other server or pass --port`); process.exit(2); }
const lock = acquireDataLock(dataDir);
if ("heldBy" in lock) { console.error(`Pack Rat (process ${lock.heldBy}) is already using the data folder ${dataDir} — close it, or pass --data <another folder>`); process.exit(2); }
const child = spawn(process.execPath, [join(ROOT, "app", "vault-server.mts"), ...args], { stdio: "inherit" });
// A signal to this wrapper (`kill <pid>`, a process manager's SIGTERM) is passed on to the server, and
// this process exits when the server does. Without the handlers the wrapper dies alone and leaves the
// server running and holding the port. Ctrl+C already reaches both, as one process group.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
// A server killed by a signal (an OOM kill, SIGKILL) has no exit code; report it the way a shell
// does, 128 + the signal number, rather than as a clean 0.
child.on("exit", (code, signal) => process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0)));
