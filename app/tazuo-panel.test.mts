// tazuo-panel.test.mts — app/tazuo-panel.mts: the panel hotkey's validation, the TazUO-is-running
// decision, and the merge-only edit of TazUO's lscript.json (every test in a temp folder).
//
// Run: node --test app/tazuo-panel.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { panelPrefsError, panelPrefsOf, PANEL_DEFAULTS, setGlobalAutostart, syncOpenAtLogin, tazuoRunning, lscriptPathFor, type Run } from "./tazuo-panel.mts";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// <tmp>/TazUO/LegionScripts (with the panel installed) and <tmp>/TazUO/Data.
function client({ panel = true }: { panel?: boolean } = {}): { scriptsDir: string; lscript: string } {
  const root = mkdtempSync(join(tmpdir(), "qm-tazuo-panel-"));
  const scriptsDir = join(root, "TazUO", "LegionScripts");
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(join(root, "TazUO", "Data"));
  if (panel) writeFileSync(join(scriptsDir, "packrat-panel.py"), "# panel\n");
  return { scriptsDir, lscript: lscriptPathFor(scriptsDir) };
}

test("[fast] panelPrefsError takes a modified letter or a bare F-key and refuses a bare letter, unknown modifiers and keys", () => {
  assert.equal(panelPrefsError({ hotkey: { mods: ["CTRL", "SHIFT"], key: "P" } }), null);
  assert.equal(panelPrefsError({ hotkey: { mods: [], key: "F5" }, openAtLogin: false }), null);
  assert.match(panelPrefsError({ hotkey: { mods: [], key: "P" } })!, /needs Ctrl, Alt or Shift/);
  assert.match(panelPrefsError({ hotkey: { mods: [], key: "7" } })!, /needs Ctrl, Alt or Shift/);
  for (const bad of [{ mods: ["CMD"], key: "P" }, { mods: ["CTRL", "CTRL"], key: "P" }, { mods: ["CTRL"], key: "F13" }, { mods: ["CTRL"], key: "p" }, "CTRL+P"]) {
    assert.ok(panelPrefsError({ hotkey: bad }), JSON.stringify(bad));
  }
  assert.ok(panelPrefsError({ openAtLogin: "yes" }));
  assert.ok(panelPrefsError([]));
});

test("[fast] panelPrefsOf reads a missing or invalid field as its default and orders the modifiers", () => {
  assert.deepEqual(panelPrefsOf(null), PANEL_DEFAULTS);
  assert.deepEqual(panelPrefsOf({ hotkey: { mods: [], key: "Q" }, openAtLogin: 1 }), PANEL_DEFAULTS);
  assert.deepEqual(panelPrefsOf({ hotkey: { mods: ["SHIFT", "ALT"], key: "F2" }, openAtLogin: false }), { hotkey: { mods: ["ALT", "SHIFT"], key: "F2" }, openAtLogin: false });
});

test("[fast] tazuoRunning: pgrep's and tasklist's answers, with anything unclear counted as running", () => {
  const answer = (r: ReturnType<Run>): Run => () => r;
  assert.equal(tazuoRunning("darwin", answer({ status: 0, stdout: "123\n" })), true);
  assert.equal(tazuoRunning("linux", answer({ status: 1, stdout: "" })), false);
  assert.equal(tazuoRunning("darwin", answer({ status: 2, stdout: "" })), true);
  assert.equal(tazuoRunning("darwin", answer({ status: null, error: new Error("ENOENT") })), true);
  assert.equal(tazuoRunning("win32", answer({ status: 0, stdout: '"TazUO.exe","4242","Console","1","250,000 K"\r\n' })), true);
  assert.equal(tazuoRunning("win32", answer({ status: 0, stdout: "INFO: No tasks are running which match the specified criteria.\r\n" })), false);
  assert.equal(tazuoRunning("win32", answer({ status: 1, stdout: "" })), true);
  let asked: string[] = [];
  tazuoRunning("darwin", (cmd, args) => { asked = [cmd, ...args]; return { status: 1 }; });
  assert.deepEqual(asked, ["pgrep", "-x", "TazUO"], "the exact name, so TazUOLauncher is not the client");
});

test("[fast] setGlobalAutostart merges into lscript.json: other keys and entries kept, one BOM kept, a .bak of the original, idempotent both ways", () => {
  const { lscript } = client();
  const original = Buffer.concat([BOM, Buffer.from(JSON.stringify({ GlobalAutoStartScripts: ["other.py"], CharAutoStartScripts: { "acctDorran": ["x.py"] }, GroupCollapsed: {}, DisableModuleCache: true, FutureKey: 7 }))]);
  writeFileSync(lscript, original);
  assert.equal(setGlobalAutostart(lscript, true), "written");
  const after = readFileSync(lscript);
  assert.deepEqual([...after.subarray(0, 4)], [0xef, 0xbb, 0xbf, 0x7b], "exactly one BOM, then the document");
  const doc = JSON.parse(after.subarray(3).toString("utf8"));
  assert.deepEqual(doc, { GlobalAutoStartScripts: ["other.py", "packrat-panel.py"], CharAutoStartScripts: { acctDorran: ["x.py"] }, GroupCollapsed: {}, DisableModuleCache: true, FutureKey: 7 });
  assert.deepEqual(readFileSync(lscript + ".bak"), original);
  assert.equal(setGlobalAutostart(lscript, true), "unchanged");
  assert.equal(setGlobalAutostart(lscript, false), "written");
  assert.deepEqual(JSON.parse(readFileSync(lscript).subarray(3).toString("utf8")).GlobalAutoStartScripts, ["other.py"]);
  assert.equal(setGlobalAutostart(lscript, false), "unchanged");
});

test("[fast] setGlobalAutostart creates a missing lscript.json with just the list, adds no BOM to a file without one, and never rewrites a file it cannot read", () => {
  const { lscript } = client();
  assert.equal(setGlobalAutostart(lscript, false), "unchanged");
  assert.equal(existsSync(lscript), false);
  assert.equal(setGlobalAutostart(lscript, true), "written");
  assert.deepEqual(JSON.parse(readFileSync(lscript, "utf8")), { GlobalAutoStartScripts: ["packrat-panel.py"] });
  assert.notEqual(readFileSync(lscript)[0], 0xef);
  for (const bad of ["{not json", "[]", JSON.stringify({ GlobalAutoStartScripts: [1] })]) {
    writeFileSync(lscript, bad);
    assert.throws(() => setGlobalAutostart(lscript, true), /left it alone/);
    assert.equal(readFileSync(lscript, "utf8"), bad);
  }
});

test("[fast] syncOpenAtLogin waits while a client runs, asks only when a change is needed, and says why it cannot apply", () => {
  const { scriptsDir, lscript } = client();
  let asked = 0;
  const running = (v: boolean) => () => { asked++; return v; };
  assert.deepEqual(syncOpenAtLogin(scriptsDir, true, running(true)), { status: "pending" });
  assert.equal(existsSync(lscript), false, "nothing written while TazUO runs");
  assert.deepEqual(syncOpenAtLogin(scriptsDir, true, running(false)), { status: "applied" });
  asked = 0;
  assert.deepEqual(syncOpenAtLogin(scriptsDir, true, running(true)), { status: "unchanged" });
  assert.equal(asked, 0, "already in place: no process check at all");
  assert.equal(syncOpenAtLogin(client({ panel: false }).scriptsDir, true, running(false)).status, "error");
  const noData = mkdtempSync(join(tmpdir(), "qm-tazuo-panel-nodata-"));
  assert.equal(syncOpenAtLogin(noData, false, running(false)).status, "error");
});
