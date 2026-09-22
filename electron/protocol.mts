// protocol.mts — the message shapes carried over the two-way channel between electron/main.mts (the
// Electron main process) and electron/server-entry.mts (its utilityProcess.fork() child running the
// Pack Rat server, see docs/architecture.md's "The host bridge" section). Type-only: both files pull
// these in with `import type`, which verbatimModuleSyntax erases completely, so this module compiles
// to nothing and neither process file gains a real runtime dependency on the other because of it.
// Declared here rather than inside either file because the channel is symmetric — main.mts sends
// HostResultMessage/ShutdownMessage and receives the other three, server-entry.mts is the mirror image
// — so neither side is a natural owner of the other's half of the contract.
//
// Every message arrives as `unknown` on receipt: Electron's own types give UtilityProcess's 'message'
// event and ParentPort's 'message' event no better than `any` (see electron.d.ts), and this project's
// convention is to treat anything crossing a process boundary as `unknown` until it's checked. Narrow
// by the `type` field first; only read the rest of a message once `type` has matched one of these.
// Matching `type` is nearly all that is checked: the remaining fields (port, url, id, result) are
// trusted by a whole-object cast, exactly as the untyped code trusted them. The exception is a host
// request's `args`, which main.mts runs through electron/host-args.mts before either value reaches an
// OS call — the phase-7 security review's Important 1 is what happens when a message's own claim is
// taken as the argument to shell.openPath. These interfaces describe what the two processes send each
// other; only `args` describes something the receiving side then verifies.

// server-entry.mts -> main.mts, once startServer() is listening.
export interface ListeningMessage {
  type: "listening";
  port: number;
  url: string;
}

// server-entry.mts -> main.mts: relays one app/vault-server.mts HostBridge call that only Electron's
// main process can actually perform. `args`' shape follows HostBridge's own two method signatures
// exactly (app/vault-server.mts: pickFolder's `title` is unvalidated end to end, hence `unknown`).
// Both are checked at the far end before they reach an OS call, by electron/host-args.mts — this
// channel carries what the child SAYS, and main.mts is where that becomes what the OS is asked to do.
//
// openPath's `args` is a DISCRIMINATOR, "data" or "logs", not a path: main.mts owns those two
// directories and resolves them itself, so a compromised server child cannot name a third thing for
// the OS to launch (phase-7 security review, Important 1). The type names what the server sends; what
// arrives is still whatever the child posted, which is why main.mts checks it (host-args.mts).
export interface PickFolderRequest {
  type: "host";
  id: number;
  op: "pickFolder";
  args: { title?: unknown };
}
export interface OpenPathRequest {
  type: "host";
  id: number;
  op: "openPath";
  args: "data" | "logs";
}
export type HostRequestMessage = PickFolderRequest | OpenPathRequest;

// main.mts -> server-entry.mts, answering a HostRequestMessage by the same id. `result` is exactly
// what main.mts's handleHostOp ever computes on any path (pick a folder, cancel, an unexpected op, or
// a thrown error): a chosen path, or null. See the migration report for the full trace of why this is
// accurate rather than a widened guess, and how server-entry.mts's callHost() keeps this one wire
// shape honest against HostBridge's two different per-method promise types (pickFolder's
// `Promise<string | null>` and openPath's `Promise<void>`).
export interface HostResultMessage {
  type: "host-result";
  id: number;
  result: string | null;
}

// server-entry.mts -> main.mts. main.mts's onChildMessage already has a branch for this, but
// server-entry.mts never actually sends one today — a startup failure exits the process directly
// instead (see its own trailing try/catch) — so this is a documented, currently-unused corner of the
// protocol, unchanged by this migration.
export interface ServerErrorMessage {
  type: "error";
  message: string;
}

// main.mts -> server-entry.mts, on quit.
export interface ShutdownMessage {
  type: "shutdown";
}

export type ChildToMainMessage = ListeningMessage | HostRequestMessage | ServerErrorMessage;
export type MainToChildMessage = HostResultMessage | ShutdownMessage;
