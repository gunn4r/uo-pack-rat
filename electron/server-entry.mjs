#!/usr/bin/env node
// server-entry.mjs — the Pack Rat server, forked as an Electron utility process by
// electron/main.mjs (utilityProcess.fork). Config is env-driven: main sets PACKRAT_DATA, PACKRAT_TOKEN
// and PACKRAT_PORT=0 in the child's environment before forking, and forwards --demo (when the user
// passed it) as a fork argument, so the ordinary resolveConfig()/ensureLayout() pair in app/config.mts
// picks all of it up unchanged. The optimizer core needs no build step: config.mts's paths.core
// resolves straight to scripts/optimizer-core.mts, both in dev and in the packaged app (whose
// build.files ships that one source file — no asarUnpack entry needed for it; Electron's asar fs/module
// patches serve a dynamic `import()` of a .mts file straight out of app.asar, worker threads included,
// verified live against a real `electron-builder --dir` tree, Phase 8 Task 3).
//
// Talks to main.mjs over process.parentPort, the utility-process side of the two-way channel:
//   -> {type: "listening", port, url}                 once startServer() is listening
//   <-> {type: "host", id, op, args} / {type: "host-result", id, result}
//       forwards vault-server.mjs's host.pickFolder({title})/host.openPath(path) calls to main (only
//       Electron can show a native folder picker or ask the OS to open a path) and resolves the
//       promise vault-server.mjs is awaiting once main's matching host-result message arrives.
//   <- {type: "shutdown"}                              close the server, then exit(0)
import { ensureLayout, resolveConfig } from "../app/config.mts";
import { startServer } from "../app/vault-server.mts";

const parentPort = process.parentPort;

let nextId = 1;
const pendingHostCalls = new Map();

function callHost(op, args) {
  return new Promise((resolve) => {
    const id = nextId++;
    pendingHostCalls.set(id, resolve);
    parentPort.postMessage({ type: "host", id, op, args });
  });
}

const host = {
  pickFolder: (opts) => callHost("pickFolder", opts),
  openPath: (path) => callHost("openPath", path),
};

let closeServer = null;

async function shutdown() {
  try {
    if (closeServer) await closeServer();
  } catch (e) {
    console.error(`server-entry: error while closing: ${e?.message || e}`);
  } finally {
    process.exit(0);
  }
}

parentPort.on("message", (e) => {
  const msg = e?.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "host-result") {
    const resolve = pendingHostCalls.get(msg.id);
    if (resolve) {
      pendingHostCalls.delete(msg.id);
      resolve(msg.result);
    }
    return;
  }
  if (msg.type === "shutdown") {
    shutdown();
  }
});

try {
  const config = ensureLayout(resolveConfig());
  const { port, url, close } = await startServer(config, { host });
  closeServer = close;
  parentPort.postMessage({ type: "listening", port, url });
} catch (e) {
  console.error(`server-entry: failed to start: ${e?.stack || e}`);
  process.exit(1);
}
