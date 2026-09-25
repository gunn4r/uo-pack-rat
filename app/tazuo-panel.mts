// tazuo-panel.mts — the app's side of the TazUO in-game panel (adapters/tazuo/packrat-panel.py): its
// show/hide hotkey and "open the panel at login", both chosen in Settings or the setup wizard and kept
// in <data>/tazuo-panel.json.
//
// The hotkey needs nothing from the client: the panel re-reads tazuo-panel.json itself. "Open at login"
// is TazUO's own global autostart list, GlobalAutoStartScripts in <TazUO>/Data/lscript.json (the
// client's LScriptSettings, which it loads at login and saves at logout). That one file is edited here,
// and only while no TazUO process is running: a running client saves its own copy over it at logout
// (or asks the player which copy to keep). The list is only ever changed because the player just chose
// something here (a Settings switch, the wizard's install): if TazUO was running then, that one choice
// waits in tazuo-panel.json (pendingOpenAtLogin) and is retried at app start, when Settings is opened and
// on the next install or save, until it lands. Nothing else re-applies it, so a player who later unticks
// Autostart in the Script Manager keeps that.
// The edit merges — every other key and entry is kept, an existing UTF-8 BOM is kept, and the file it
// replaces is copied to lscript.json.bak first.
import { constants, copyFileSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { atomicReplace, writeFileAtomic } from "./atomic-write.mts";
import { panelPrefsOf, type AutostartOutcome, type PanelPrefs } from "./tazuo-panel-prefs.mts";

export const PANEL_SCRIPT = "packrat-panel.py";
const MAX_LSCRIPT_BYTES = 1024 * 1024;
export { HOTKEY_KEYS, HOTKEY_MODS, PANEL_DEFAULTS, panelPrefsError, panelPrefsOf, type AutostartOutcome, type Hotkey, type PanelPrefs } from "./tazuo-panel-prefs.mts";

// tazuo-panel.json: the prefs, plus whether an open-at-login choice is still waiting on a running client.
export interface PanelFile extends PanelPrefs { pendingOpenAtLogin: boolean }
// The in-game panel writes this file too (its open-at-login toggle), so it is read as untrusted: capped,
// each field validated, and a pending flag honoured only beside a real true/false choice.
const MAX_PANEL_FILE_BYTES = 64 * 1024;
export function readPanelFile(path: string): PanelFile {
  let raw: Record<string, unknown> | null = null;
  try {
    if (lstatSync(path).size <= MAX_PANEL_FILE_BYTES) raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch { /* missing or unreadable: the defaults */ }
  const pending = raw?.pendingOpenAtLogin === true && typeof raw?.openAtLogin === "boolean";
  return { ...panelPrefsOf(raw), pendingOpenAtLogin: pending };
}
export function writePanelFile(path: string, { pendingOpenAtLogin, ...prefs }: PanelFile, mode?: number): void {
  writeFileAtomic(path, JSON.stringify({ ...panelPrefsOf(prefs), ...(pendingOpenAtLogin ? { pendingOpenAtLogin } : {}) }, null, 2) + "\n", mode);
}

// <TazUO>/Data/lscript.json, where <TazUO> is the parent of the nearest folder named LegionScripts at or
// above the scripts folder (a Script Manager group folder sits inside it). null when there is none, so
// nothing is ever created beside a folder that is not TazUO's.
export function lscriptPathFor(scriptsDir: string, platform: NodeJS.Platform = process.platform): string | null {
  const same = (name: string): boolean => platform === "win32" ? name.toLowerCase() === "legionscripts" : name === "LegionScripts";
  for (let dir = scriptsDir; dirname(dir) !== dir; dir = dirname(dir)) {
    if (same(basename(dir))) return join(dirname(dir), "Data", "lscript.json");
  }
  return null;
}

// Is a TazUO client running? Anything that fails to answer counts as running: the safe side is to wait.
// `run` is spawnSync's shape, injectable for the tests.
export type Run = (cmd: string, args: string[]) => { status: number | null; stdout?: string | Buffer | null; error?: Error | undefined };
const defaultRun: Run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", timeout: 5000, windowsHide: true });
export function tazuoRunning(platform: NodeJS.Platform = process.platform, run: Run = defaultRun): boolean {
  if (platform === "win32") {
    const r = run("tasklist", ["/FI", "IMAGENAME eq TazUO.exe", "/FO", "CSV", "/NH"]);
    if (r.error || r.status !== 0) return true;
    return String(r.stdout ?? "").toLowerCase().includes('"tazuo.exe"');
  }
  const r = run("pgrep", ["-x", "TazUO(\\.exe)?"]);   // TazUO.exe too: the Windows build under Wine
  if (r.error) return true;
  return r.status !== 1;          // pgrep: 0 found, 1 none, anything else an error
}

interface Lscript { bom: boolean; doc: Record<string, unknown>; list: string[]; exists: boolean }

function readLscript(path: string): Lscript {
  let st;
  try { st = lstatSync(path); } catch { return { bom: false, doc: {}, list: [], exists: false }; }
  if (!st.isFile()) throw new Error("lscript.json is not a regular file; left it alone");
  if (st.size > MAX_LSCRIPT_BYTES) throw new Error("lscript.json is unexpectedly large; left it alone");
  const buf = readFileSync(path);
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  let doc: unknown;
  try { doc = JSON.parse(buf.subarray(bom ? 3 : 0).toString("utf8")); } catch { throw new Error("lscript.json is not valid JSON; left it alone"); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("lscript.json is not in the shape TazUO writes; left it alone");
  const list = (doc as Record<string, unknown>).GlobalAutoStartScripts;
  if (list !== undefined && !(Array.isArray(list) && list.every((s) => typeof s === "string"))) {
    throw new Error("lscript.json's GlobalAutoStartScripts is not a list of names; left it alone");
  }
  return { bom, doc: doc as Record<string, unknown>, list: (list as string[] | undefined) ?? [], exists: true };
}

// Whether TazUO's global autostart list holds the panel today; null when it cannot be read.
export function autostartOn(scriptsDir: string): boolean | null {
  const path = lscriptPathFor(scriptsDir);
  try { return path ? readLscript(path).list.includes(PANEL_SCRIPT) : null; } catch { return null; }
}

// Add the panel to, or remove it from, GlobalAutoStartScripts. Merge only: the rest of the document is
// written back as it was read, with its BOM if it had one. A missing file is created holding just that
// key (TazUO fills in the rest of its defaults when it loads).
export function setGlobalAutostart(path: string, on: boolean): "unchanged" | "written" {
  const cur = readLscript(path);
  if (cur.list.includes(PANEL_SCRIPT) === on) return "unchanged";
  const list = on ? [...cur.list, PANEL_SCRIPT] : cur.list.filter((s) => s !== PANEL_SCRIPT);
  if (cur.exists) atomicReplace(`${path}.bak`, (tmp) => copyFileSync(path, tmp, constants.COPYFILE_EXCL));
  writeFileAtomic(path, (cur.bom ? "\ufeff" : "") + JSON.stringify({ ...cur.doc, GlobalAutoStartScripts: list }, null, 2));
  return "written";
}


// Bring lscript.json in line with the player's choice, unless a client is running (then "pending").
export function syncOpenAtLogin(scriptsDir: string, on: boolean, running: () => boolean): AutostartOutcome {
  const path = lscriptPathFor(scriptsDir);
  if (!path) return { status: "error", error: "The scripts folder is not inside a LegionScripts folder, so Pack Rat cannot find TazUO's settings" };
  if (!existsSync(dirname(path))) return { status: "error", error: "No Data folder beside LegionScripts, so this does not look like a TazUO folder" };
  if (on && !existsSync(join(scriptsDir, PANEL_SCRIPT))) return { status: "error", error: `${PANEL_SCRIPT} is not installed yet: reinstall the scripts first` };
  try {
    if (readLscript(path).list.includes(PANEL_SCRIPT) === on) return { status: "unchanged" };
    if (running()) return { status: "pending" };
    return { status: setGlobalAutostart(path, on) === "written" ? "applied" : "unchanged" };
  } catch (e) { return { status: "error", error: (e as Error).message }; }
}
