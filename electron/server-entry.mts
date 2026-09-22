#!/usr/bin/env node
// server-entry.mts — the Pack Rat server, forked as an Electron utility process by
// electron/main.mts (utilityProcess.fork). Config is env-driven: main sets PACKRAT_DATA, PACKRAT_TOKEN
// and PACKRAT_PORT=0 in the child's environment before forking, and forwards --demo (when the user
// passed it) as a fork argument, so the ordinary resolveConfig()/ensureLayout() pair in app/config.mts
// picks all of it up unchanged. The optimizer core needs no build step: config.mts's paths.core
// resolves straight to scripts/optimizer-core.mts, both in dev and in the packaged app (whose
// build.files ships that one source file — no asarUnpack entry needed for it; Electron's asar fs/module
// patches serve a dynamic `import()` of a .mts file straight out of app.asar, worker threads included,
// verified live against a real `electron-builder --dir` tree, Phase 8 Task 3).
//
// This file itself does no building: main.mts builds the schema types and the browser-facing page
// (scripts/build-schema-types.mts, scripts/build-ui.mts) before it ever forks this one, and only in a
// dev checkout (!app.isPackaged) — a packaged app ships a pre-built app/dist/ and no scripts/ at all
// beyond optimizer-core.mts, so this module's own graph must stay safe to load without scripts/
// existing, which ruling out any build step here (even a conditional one) guarantees.
//
// Talks to main.mts over process.parentPort, the utility-process side of the two-way channel described
// in full by ./protocol.mts:
//   -> ListeningMessage                                once startServer() is listening
//   <-> HostRequestMessage / HostResultMessage
//       forwards vault-server.mts's host.pickFolder({title})/host.openPath(path) calls to main (only
//       Electron can show a native folder picker or ask the OS to open a path) and resolves the
//       promise vault-server.mts is awaiting once main's matching host-result message arrives — or
//       rejects it once ./pending-calls.mts's timeout expires, for an answer that never comes.
//   <- ShutdownMessage                                 close the server, then exit(0)
import { ensureLayout, resolveConfig } from "../app/config.mts";
import { startServer } from "../app/vault-server.mts";
import type { HostBridge } from "../app/vault-server.mts";
import { createPendingHostCalls } from "./pending-calls.mts";
import type { HostRequestMessage, HostResultMessage, ListeningMessage } from "./protocol.mts";

// This module only ever runs as an Electron utilityProcess.fork() entry point (electron/main.mts's
// spawnChild()), so process.parentPort is always set — Electron's own types agree (declared as always
// present, not optional/nullable, on the ambient `NodeJS.Process` augmentation in electron.d.ts, even
// though that declaration's own doc comment says it can be null outside a utility process). The alias
// below just names the invariant, the same way app/optimize-worker.mts names the equivalent
// worker_threads invariant for its own parentPort. If this file were ever run outside a utility
// process, `parentPort` would actually be undefined at runtime regardless of what its type claims, and
// the first call below (`.on(...)`) would throw a plain TypeError and crash the process immediately —
// exactly what happened before this migration too; nothing about that changed.
const parentPort = process.parentPort;

// Every relayed call is registered here and expires on its own (./pending-calls.mts): main.mts drops
// a result whose originating child is gone, so without an expiry the promise below — and the HTTP
// request awaiting it — would never settle at all.
const pendingHostCalls = createPendingHostCalls();

// Two overloads keep pickFolder's and openPath's promises honest to HostBridge's two different
// per-method shapes (Promise<string | null> vs. Promise<void>); the implementation signature below is
// deliberately looser (Promise<unknown>) because it has no way to prove to the compiler that whichever
// op was actually requested is the one whose result comes back — that's a trust boundary this file
// already documents (HostBridge's own comment: "Neither method's argument/return shape is validated by
// this file"), not something a runtime check here could close without changing what value reaches the
// caller.
function callHost(op: "pickFolder", args: { title?: unknown }): Promise<string | null>;
function callHost(op: "openPath", args: string): Promise<void>;
function callHost(op: HostRequestMessage["op"], args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = pendingHostCalls.start(resolve, reject);
    parentPort.postMessage({ type: "host", id, op, args } as HostRequestMessage);
  });
}

const host: HostBridge = {
  pickFolder: (opts) => callHost("pickFolder", opts),
  openPath: (path) => callHost("openPath", path),
};

let closeServer: (() => Promise<void>) | null = null;

async function shutdown(): Promise<void> {
  try {
    if (closeServer) await closeServer();
  } catch (e) {
    console.error(`server-entry: error while closing: ${(e as Error)?.message || e}`);
  } finally {
    process.exit(0);
  }
}

parentPort.on("message", (e) => {
  const msg: unknown = e?.data;
  if (!msg || typeof msg !== "object") return;
  if ((msg as { type: unknown }).type === "host-result") {
    // A false return is a result for a call that is no longer waiting (it expired, or was already
    // answered) — there is nothing to deliver it to, so it is dropped.
    pendingHostCalls.settle((msg as HostResultMessage).id, (msg as HostResultMessage).result);
    return;
  }
  if ((msg as { type: unknown }).type === "shutdown") {
    shutdown();
  }
});

try {
  const config = ensureLayout(resolveConfig());
  const { port, url, close } = await startServer(config, { host });
  closeServer = close;
  parentPort.postMessage({ type: "listening", port, url } as ListeningMessage);
} catch (e) {
  console.error(`server-entry: failed to start: ${(e as Error)?.stack || e}`);
  process.exit(1);
}
