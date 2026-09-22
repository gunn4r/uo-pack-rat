// pending-calls.mts — the id→promise registry electron/server-entry.mts keeps for the host calls it
// has relayed to the main process (see ./protocol.mts's HostRequestMessage/HostResultMessage). Split
// out of that file for the same reason electron/host-args.mts was split out of main.mts: server-entry
// .mts only ever loads inside a real Electron utility process (it reads process.parentPort and starts
// the server at module scope), so nothing inside it is reachable from node:test — and a registry with
// an expiry rule of its own is exactly the part that should be.
//
// Every entry expires. Before this module existed nothing bounded one: a host call whose answer never
// came back — the main process now deliberately drops a result whose originating child is gone, see
// main.mts's handleHostOp — left its resolve function in the map for the life of the process and its
// promise pending for ever. The bound here and app/vault-server.mts's own withHostTimeout are the
// same 60 s on purpose: whichever side notices first, the caller sees the same 504, because the error
// below carries the `statusCode` that server's route handler reads off a thrown error (both run in
// this same process — server-entry.mts is what hosts startServer()).

export interface PendingHostCalls {
  // Registers one call in flight and returns its wire id. `reject` is called with the error below if
  // no result arrives before the timeout, and the entry is dropped either way — a call settles once.
  start(resolve: (result: unknown) => void, reject: (e: Error) => void): number;
  // Delivers a result to the call that asked for it. false means there was no such call any more (an
  // id that already timed out, was already answered, or was never issued) and the result is dropped.
  settle(id: number, result: unknown): boolean;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Matches HOST_CALL_TIMEOUT_MS in app/vault-server.mts — see the module comment above.
export const HOST_CALL_TIMEOUT_MS = 60 * 1000;

// The same message and status the server's own withHostTimeout answers with, so a folder dialog that
// never comes back reads identically to the player whichever of the two bounds fired first.
function hostTimeoutError(): Error {
  const e = new Error("the desktop app did not answer") as Error & { statusCode?: number };
  e.statusCode = 504;
  return e;
}

export function createPendingHostCalls(timeoutMs: number = HOST_CALL_TIMEOUT_MS): PendingHostCalls {
  const pending = new Map<number, PendingCall>();
  let nextId = 1;
  return {
    start(resolve, reject) {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(hostTimeoutError());
      }, timeoutMs);
      // A call waiting on a native dialog must never be the reason this process stays alive.
      timer.unref?.();
      pending.set(id, { resolve, timer });
      return id;
    },
    settle(id, result) {
      const call = pending.get(id);
      if (!call) return false;
      pending.delete(id);
      clearTimeout(call.timer);
      call.resolve(result);
      return true;
    },
  };
}
