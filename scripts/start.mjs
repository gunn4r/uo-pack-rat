#!/usr/bin/env node
// start.mjs — start the Pack Rat server (bare, no Electron). Flags pass through to the server.
//   npm start -- --open        npm start -- --demo --port 9000
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../app/config.mjs";
import { buildCore } from "./build-core.mjs";
import { buildUi } from "./build-ui.mjs";

buildCore();
buildUi();
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let port;
try {
  ({ port } = resolveConfig(args));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const free = await new Promise((ok) => { const s = createServer(); s.once("error", () => ok(false)); s.listen(port, "127.0.0.1", () => s.close(() => ok(true))); });
if (!free) { console.error(`port ${port} is in use — stop the other server or pass --port`); process.exit(2); }
const child = spawn(process.execPath, [join(ROOT, "app", "vault-server.mjs"), ...args], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
