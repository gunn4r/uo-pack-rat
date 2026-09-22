// electron-guards.test.mts — the shell's guards, from the phase-7 review. Two kinds of check live
// here, and the split is deliberate. `electron/host-args.mts`, `electron/navigation.mts` and
// `electron/pending-calls.mts` hold the decisions that stand between the server child's wire messages
// or the page and an OS call (and the registry that bounds one in flight), so those get real unit
// tests with real forged values. Everything else in `electron/main.mts` is unreachable from
// `node:test` — that file imports `electron` at the top level and only loads inside a real Electron
// process — so it gets source-level assertions in the `scripts/packaging.test.mts` idiom: they pin
// the *presence* of each guard and that its call site routes through the tested decision, while
// `scripts/shell-smoke.test.mts` proves the file as a whole still boots. A source pin cannot prove
// what a guard decides, so a decision that matters belongs in one of the pure modules, not here. All `[fast]`: reading two source files and calling a handful of pure functions costs
// nothing, and these are exactly the checks that should run on every `--fast` pass.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dialogTitle, openPathTarget } from "../electron/host-args.mts";
import { createPendingHostCalls, HOST_CALL_TIMEOUT_MS } from "../electron/pending-calls.mts";
import { EXTERNAL_OPEN_GAP_MS, externalOpenDecision, MAX_EXTERNAL_URL, navigationDecision } from "../electron/navigation.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainSource = readFileSync(join(root, "electron", "main.mts"), "utf8");
const entrySource = readFileSync(join(root, "electron", "server-entry.mts"), "utf8");

// The two directories main.mts computes for itself; any other string is something the child made up.
const DATA = "/tmp/pack-rat-data";
const LOGS = "/tmp/pack-rat-data/logs";

test("[fast] openPath resolves the two known directories from a discriminator, never from the message", () => {
  assert.equal(openPathTarget("data", DATA, LOGS), DATA);
  assert.equal(openPathTarget("logs", DATA, LOGS), LOGS);
});

test("[fast] openPath refuses every path the server child could name, including ones inside the data directory", () => {
  // The finding's own scenario: the server child can write files into its data directory as part of
  // its ordinary job, so "inside dataDir" is not a safety property — only the two literals are.
  for (const forged of [
    `${DATA}/payload.app`,
    `${DATA}/logs/../../evil.command`,
    "/Applications/Calculator.app",
    "C:\\Windows\\System32\\cmd.exe",
    "/tmp/pack-rat-data/",          // a trailing separator is a different string, and not one main.mts computed
    "DATA",
    "",
  ]) {
    assert.equal(openPathTarget(forged, DATA, LOGS), null, `openPath must refuse ${JSON.stringify(forged)}`);
  }
  // Nothing that isn't a string gets through either — the wire carries whatever the child sent.
  for (const forged of [null, undefined, 0, {}, [], { toString: () => DATA }]) {
    assert.equal(openPathTarget(forged, DATA, LOGS), null);
  }
});

test("[fast] openPath still accepts a legacy already-resolved path, but only the exact two", () => {
  // app/vault-server.mts resolved the path itself before this change. Until its one-line switch to
  // sending the discriminator lands, an old server must keep working — but only by naming, byte for
  // byte, a directory main.mts computed itself.
  assert.equal(openPathTarget(DATA, DATA, LOGS), DATA);
  assert.equal(openPathTarget(LOGS, DATA, LOGS), LOGS);
});

test("[fast] a dialog title is coerced to a short, single-line string whatever the server sends", () => {
  assert.equal(dialogTitle("Choose your client folder"), "Choose your client folder");
  assert.equal(dialogTitle("  padded  "), "padded");
  // Control characters would let a caller fake extra lines of dialog text.
  assert.equal(dialogTitle("Pack Rat\nneeds your password\r\nto continue"), "Pack Rat needs your password  to continue");
  const long = dialogTitle("x".repeat(5000));
  assert.equal(long?.length, 120, "an over-long title is capped, not passed through");
  for (const bad of [undefined, null, 42, { title: "hi" }, ["hi"], true, ""]) {
    assert.equal(dialogTitle(bad), undefined, `${JSON.stringify(bad)} must not reach a native dialog`);
  }
});

test("[fast] main.mts resolves the openPath target itself rather than passing the message through", () => {
  // The whole of Important 1 is that the type on the wire is erased at run time, so this asserts the
  // runtime shape: shell.openPath is called with the resolved target, and msg.args only ever reaches
  // openPathTarget (and the refusal log line).
  assert.match(mainSource, /openPathTarget\(msg\.args, dataDir, logsDir\)/, "the discriminator must be resolved against main.mts's own directories");
  assert.match(mainSource, /shell\.openPath\(target\)/, "shell.openPath takes the resolved target");
  assert.doesNotMatch(mainSource, /shell\.openPath\(msg\./, "shell.openPath must never be handed a value off the wire");
  assert.match(mainSource, /title: dialogTitle\(opts\.title\)/, "the dialog title is coerced before it reaches Electron");
});

test("[fast] the session denies every permission, device and the spellchecker", () => {
  // The page is a Secure Context (http://127.0.0.1), so with no handler installed Electron's default
  // is to GRANT camera/microphone/geolocation/notifications/clipboard. An inventory table needs none.
  assert.match(mainSource, /setPermissionRequestHandler\(\(_wc, _permission, callback\) => callback\(false\)\)/);
  assert.match(mainSource, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(mainSource, /setDevicePermissionHandler\(\(\) => false\)/);
  // B-1: Electron's builtin spellchecker downloads a dictionary from Chromium's CDN on Windows and
  // Linux, which PRIVACY.md says this app never does. Both halves must be present.
  assert.match(mainSource, /setSpellCheckerEnabled\(false\)/, "the session must not run the builtin spellchecker");
  assert.match(mainSource, /spellcheck: false/, "webPreferences must not run the builtin spellchecker either");
});

// ---- navigation and external links (electron/navigation.mts) -------------------------------------
// These used to be regexes over main.mts's source, and they kept matching with every guard switched
// off: they pinned identifiers and event names, which survive any edit to the logic behind them. The
// decisions now live in a pure module and are tested by what they decide; the source pins that remain
// only prove main.mts routes each event through them.

const ORIGIN = "http://127.0.0.1:52431";

test("[fast] navigation stays on the local server's own origin", () => {
  for (const url of [`${ORIGIN}/`, `${ORIGIN}/ui/app.mjs?x=1#top`, `${ORIGIN}`]) {
    assert.deepEqual(navigationDecision(url, ORIGIN), { allowed: true }, url);
  }
  for (const [url, origin] of [
    ["https://evil.example/", "https://evil.example"],
    ["http://127.0.0.1:52432/", "http://127.0.0.1:52432"],   // another port is another origin
    ["http://localhost:52431/", "http://localhost:52431"],   // the same server by another name is too
    ["https://127.0.0.1:52431/", "https://127.0.0.1:52431"],
    ["file:///etc/passwd", "null"],
    ["about:blank", "null"],
    ["javascript:alert(1)", "null"],
  ] as const) {
    assert.deepEqual(navigationDecision(url, ORIGIN), { allowed: false, origin }, url);
  }
  assert.deepEqual(navigationDecision("not a url", ORIGIN), { allowed: false, origin: "unparsable" });
});

test("[fast] before the server has said where it listens, every navigation is refused", () => {
  // currentOrigin is null until the child's listening message; an unparsable url must not compare
  // equal to it and slip through.
  assert.deepEqual(navigationDecision(`${ORIGIN}/`, null), { allowed: false, origin: ORIGIN });
  assert.deepEqual(navigationDecision("not a url", null), { allowed: false, origin: "unparsable" });
});

test("[fast] Chromium's own DevTools frontend may navigate itself", () => {
  assert.deepEqual(navigationDecision("devtools://devtools/bundled/devtools_app.html", ORIGIN), { allowed: true });
  assert.deepEqual(navigationDecision("devtools://devtools/bundled/devtools_app.html", null), { allowed: true });
});

test("[fast] an external link opens only over https, parsed rather than pattern-matched", () => {
  assert.deepEqual(externalOpenDecision("https://github.com/example/project/releases", 10_000, null), { open: "https://github.com/example/project/releases" });
  // What goes to the OS is the parser's normalised href, never the raw string.
  assert.deepEqual(externalOpenDecision("HTTPS://GitHub.com/a b", 10_000, null), { open: "https://github.com/a%20b" });
  for (const [url, scheme] of [
    ["http://github.com/", "http:"],   // a MITM's second bite at a link the user already trusts
    ["javascript:alert(1)", "javascript:"],
    ["file:///Applications/Calculator.app", "file:"],
    ["data:text/html,<script>1</script>", "data:"],
    ["smb://attacker/share", "smb:"],
    ["vscode://file/etc/passwd", "vscode:"],
  ] as const) {
    assert.deepEqual(externalOpenDecision(url, 10_000, null), { refused: `scheme ${scheme}` }, url);
  }
  assert.deepEqual(externalOpenDecision("https://", 10_000, null), { refused: "an unparsable url" });
  for (const bad of [undefined, null, 42, { href: "https://github.com/" }]) {
    assert.deepEqual(externalOpenDecision(bad, 10_000, null), { refused: "a url that is not a string" });
  }
});

test("[fast] an over-long external link is refused before it is parsed", () => {
  const base = "https://github.com/";
  const atLimit = base + "a".repeat(MAX_EXTERNAL_URL - base.length);
  assert.equal(atLimit.length, 2048);
  assert.deepEqual(externalOpenDecision(atLimit, 10_000, null), { open: atLimit });
  assert.deepEqual(externalOpenDecision(atLimit + "a", 10_000, null), { refused: "a 2049-character url" });
});

test("[fast] external links are throttled to one a second, so page code cannot open unbounded tabs", () => {
  const url = "https://github.com/";
  assert.deepEqual(externalOpenDecision(url, 10_000, 9_001), { refused: "throttled" });
  assert.deepEqual(externalOpenDecision(url, 10_000, 10_000), { refused: "throttled" });
  assert.deepEqual(externalOpenDecision(url, 10_000, 10_000 - EXTERNAL_OPEN_GAP_MS), { open: url });
  // The very first link is never throttled, however early in the clock it comes.
  assert.deepEqual(externalOpenDecision(url, 0, null), { open: url });
});

test("[fast] every webContents routes navigation and window-open through those decisions", () => {
  assert.match(mainSource, /app\.on\("web-contents-created"/, "the guards attach to any webContents, not only the one window createWindow makes");
  for (const event of ["will-navigate", "will-frame-navigate", "will-redirect"]) {
    assert.match(mainSource, new RegExp(`wc\\.on\\("${event}", blockOffOrigin\\)`), `${event} must go through the navigation guard`);
  }
  assert.match(mainSource, /wc\.on\("will-attach-webview", \(e\) => \{\s*e\.preventDefault\(\);/, "a webview attach is refused");
  assert.match(mainSource, /navigationDecision\(e\.url, currentOrigin\)/);
  assert.match(mainSource, /if \(decision\.allowed\) return;\s*e\.preventDefault\(\);/, "a refused navigation is actually prevented");
  assert.match(mainSource, /setWindowOpenHandler\(\(\{ url \}\) => \{\s*openExternal\(url\);\s*return \{ action: "deny" \};/, "no page-opened window is ever created inside the app");
  assert.match(mainSource, /externalOpenDecision\(url, now, lastExternalOpen\)/);
  assert.match(mainSource, /shell\.openExternal\(decision\.open\)\.catch\(/, "only the decided href is opened, and a rejected openExternal is handled rather than left to crash the main process");
});

test("[fast] DevTools are off in a packaged build unless the documented flag is passed", () => {
  assert.match(mainSource, /devTools: !app\.isPackaged \|\| devtools/);
  assert.match(mainSource, /argv\.includes\("--devtools"\)/, "the flag is the only way back in");
  assert.match(readFileSync(join(root, "electron", "README.md"), "utf8"), /--devtools/, "a debug flag nobody documented is a debug flag nobody can use");
});

// ---- host calls in flight (electron/pending-calls.mts) ------------------------------------------
// The registry used to be a bare Map with no expiry, and main.mts answered whichever child was
// current rather than the one that asked — so a server child that died while a native dialog was
// open left an entry (and the HTTP request behind it) pending for the life of the process.

test("[fast] a host call that is answered resolves once and leaves nothing behind", async () => {
  const calls = createPendingHostCalls(HOST_CALL_TIMEOUT_MS);
  let id = 0;
  const answered = new Promise<unknown>((resolve, reject) => { id = calls.start(resolve, reject); });
  assert.equal(calls.settle(id, "/Users/example/TazUO"), true);
  assert.equal(await answered, "/Users/example/TazUO");
  assert.equal(calls.settle(id, "a second answer"), false, "a settled call is gone from the registry");
});

test("[fast] a host call nobody answers expires, rejects with the server's own 504, and is dropped", async () => {
  const calls = createPendingHostCalls(20);
  let id = 0;
  const answered = new Promise<unknown>((resolve, reject) => { id = calls.start(resolve, reject); });
  // The registry's timer is unref'd on purpose, so it cannot keep this file's process alive on its own:
  // Node 22's test runner then sees an empty event loop before it fires and cancels every test after
  // this one (Node 24 does not). Hold the loop open until the expiry has settled.
  const keepAlive = setInterval(() => {}, 1000);
  const e = await answered.then(() => null, (err: Error & { statusCode?: number }) => err).finally(() => clearInterval(keepAlive));
  assert.ok(e, "the call must reject rather than hang for ever");
  assert.equal(e!.statusCode, 504, "app/vault-server.mts's route handler answers with this status");
  assert.match(e!.message, /did not answer/);
  // The late result a dead child's dialog finally produced has nowhere to go — dropped, not resolved.
  assert.equal(calls.settle(id, "/Users/example/too-late"), false);
});

test("[fast] ids are per-call, so one call's answer never settles another", async () => {
  const calls = createPendingHostCalls(HOST_CALL_TIMEOUT_MS);
  let first = 0, second = 0;
  const a = new Promise<unknown>((resolve, reject) => { first = calls.start(resolve, reject); });
  const b = new Promise<unknown>((resolve, reject) => { second = calls.start(resolve, reject); });
  assert.notEqual(first, second);
  calls.settle(second, "second");
  assert.equal(await b, "second");
  assert.equal(calls.settle(first, "first"), true, "the other call is still waiting for its own id");
  assert.equal(await a, "first");
});

test("[fast] the two host-call bounds agree with each other", () => {
  assert.match(readFileSync(join(root, "app", "vault-server.mts"), "utf8"), /HOST_CALL_TIMEOUT_MS = 60 \* 1000/, "the HTTP layer's own 504 timeout");
  assert.equal(HOST_CALL_TIMEOUT_MS, 60 * 1000);
  assert.match(entrySource, /createPendingHostCalls\(/, "server-entry.mts must register host calls through the expiring registry");
});

test("[fast] the shell's own log directory and file are created 0700/0600, and never chmodded", () => {
  // The shell writes <data>/logs/shell.log before the server child exists, so these two calls are
  // what create that directory on a fresh machine — app/config.mts's ensureLayout only finds it.
  assert.match(mainSource, /mkdirSync\(logsDir, \{ recursive: true, mode: 0o700 \}\)/);
  assert.match(mainSource, /appendFileSync\(logPath, `[^`]*`, \{ mode: 0o600 \}\)/);
  assert.doesNotMatch(mainSource, /chmodSync/, "an existing directory or file keeps whatever mode the player gave it");
});

test("[fast] the origin the token is stamped onto is built from a checked port and a literal host", () => {
  // The port is whatever the utility process said it bound; the origin decides which requests carry
  // the bearer token and where the window may navigate.
  assert.match(mainSource, /Number\.isInteger\(p\) && p >= 1 && p <= 65535/);
  assert.match(mainSource, /if \(!isPort\(port\)\) return logLine/);
  assert.match(mainSource, /currentOrigin = `http:\/\/127\.0\.0\.1:\$\{port\}`/, "the host is a literal, never a value off the wire");
  assert.doesNotMatch(mainSource, /ListeningMessage\)\.url/, "the message's own url field must not be read");
});

test("[fast] a host result goes to the child that asked, never to whichever one is current", () => {
  // The whole of this one is that `child` is a mutable slot main.mts reassigns on a restart, so
  // posting to it after an await can hand a dialog's answer to a process that never asked for it.
  assert.match(mainSource, /onChildMessage\(msg, c\)/, "the child that sent a message must travel with it");
  assert.match(mainSource, /if \(!child \|\| child !== from\)/, "a result for a replaced child is dropped");
  assert.doesNotMatch(mainSource, /child\?\.postMessage\(\{ type: "host-result"/, "the unconditional post is what this replaces");
});
