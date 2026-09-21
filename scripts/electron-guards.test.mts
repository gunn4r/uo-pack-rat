// electron-guards.test.mts — the shell's security guards, from the phase-7 review. Two kinds of
// check live here, and the split is deliberate. `electron/host-args.mts` holds the two decisions that
// stand between the server child's wire messages and an OS call, so those get real unit tests with
// real forged values. Everything else in `electron/main.mts` is unreachable from `node:test` — that
// file imports `electron` at the top level and only loads inside a real Electron process — so it gets
// source-level assertions in the `scripts/packaging.test.mts` idiom: they pin the *presence* of each
// guard, which is what a later refactor is most likely to drop, while `scripts/shell-smoke.test.mts`
// proves the file as a whole still boots. All `[fast]`: reading two source files and calling two pure
// functions costs nothing, and these are exactly the checks that should run on every `--fast` pass.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dialogTitle, openPathTarget } from "../electron/host-args.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainSource = readFileSync(join(root, "electron", "main.mts"), "utf8");

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

test("[fast] every webContents inherits the navigation and window-open guards, subframes included", () => {
  assert.match(mainSource, /app\.on\("web-contents-created"/, "the guards attach to any webContents, not only the one window createWindow makes");
  for (const event of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
    assert.match(mainSource, new RegExp(`wc\\.on\\("${event}"`), `${event} must be guarded`);
  }
  assert.match(mainSource, /setWindowOpenHandler/);
  assert.match(mainSource, /action: "deny"/, "no page-opened window is ever created inside the app");
});

test("[fast] an external link is parsed, bounded and throttled rather than regex-tested and fired", () => {
  // Minor 2: the old handler regex-tested the scheme, dropped openExternal's promise, and had no
  // length or rate bound. There is deliberately no host allowlist — see the comment at that call site.
  assert.match(mainSource, /new URL\(url\)/, "the url must be parsed, not pattern-matched");
  assert.match(mainSource, /parsed\.protocol !== "https:"/, "http: is not good enough for a link the user is about to trust");
  assert.match(mainSource, /MAX_EXTERNAL_URL/, "an over-long url is refused");
  assert.match(mainSource, /EXTERNAL_OPEN_GAP_MS/, "page code must not be able to open unbounded browser tabs");
  assert.match(mainSource, /shell\.openExternal\(parsed\.href\)\.catch\(/, "a rejected openExternal must be handled, not left to crash the main process");
});

test("[fast] DevTools are off in a packaged build unless the documented flag is passed", () => {
  assert.match(mainSource, /devTools: !app\.isPackaged \|\| devtools/);
  assert.match(mainSource, /argv\.includes\("--devtools"\)/, "the flag is the only way back in");
  assert.match(readFileSync(join(root, "electron", "README.md"), "utf8"), /--devtools/, "a debug flag nobody documented is a debug flag nobody can use");
});
