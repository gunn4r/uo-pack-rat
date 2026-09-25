// tazuo-panel.mts — the app's side of the TazUO in-game panel (adapters/tazuo/packrat-panel.py): its
// show/hide hotkey and "open the panel at login", both chosen in Settings or the setup wizard and kept
// in <data>/tazuo-panel.json.
//
// The hotkey needs nothing from the client: the panel re-reads tazuo-panel.json itself. "Open at login"
// is TazUO's own global autostart list, GlobalAutoStartScripts in <TazUO>/Data/lscript.json (the
// client's LScriptSettings, which it loads at login and saves at logout). That one file is edited here,
// and only while no TazUO process is running: a running client saves its own copy over it at logout
// (or asks the player which copy to keep). While one runs, the choice waits in tazuo-panel.json and is
// applied the next time the app looks and finds no client (an install, a Settings save, app start).
// The edit merges — every other key and entry is kept, an existing UTF-8 BOM is kept, and the file it
// replaces is copied to lscript.json.bak first.
import { constants, copyFileSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { atomicReplace, writeFileAtomic } from "./atomic-write.mts";

export const PANEL_SCRIPT = "packrat-panel.py";
export const HOTKEY_MODS = ["CTRL", "ALT", "SHIFT"] as const;
export const HOTKEY_KEYS: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
];
export interface Hotkey { mods: string[]; key: string }
export interface PanelPrefs { hotkey: Hotkey; openAtLogin: boolean }
export const PANEL_DEFAULTS: PanelPrefs = { hotkey: { mods: ["CTRL", "SHIFT"], key: "P" }, openAtLogin: true };
const MAX_LSCRIPT_BYTES = 1024 * 1024;

// TazUO's OnHotKey matches modifiers exactly and fires even while the chat box has focus, so a letter or
// digit with no modifier would fire on every chat line that contains it; an F-key alone is fine.
function hotkeyError(v: unknown): string | null {
  const h = v as Record<string, unknown> | null;
  if (!h || typeof h !== "object" || Array.isArray(h)) return "hotkey must be {mods, key}";
  const { mods, key } = h;
  if (!Array.isArray(mods) || !mods.every((m) => (HOTKEY_MODS as readonly unknown[]).includes(m)) || new Set(mods).size !== mods.length) {
    return "hotkey.mods must be a list of CTRL, ALT and SHIFT (each at most once)";
  }
  if (typeof key !== "string" || !HOTKEY_KEYS.includes(key)) return "hotkey.key must be A–Z, 0–9 or F1–F12";
  if (key.length === 1 && mods.length === 0) return "A letter or digit needs Ctrl, Alt or Shift: on its own it would fire while you type in chat";
  return null;
}

// PUT /api/tazuo-panel's body: any subset of {hotkey, openAtLogin}.
export function panelPrefsError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "expected {hotkey?, openAtLogin?}";
  const o = v as Record<string, unknown>;
  if ("hotkey" in o) { const e = hotkeyError(o.hotkey); if (e) return e; }
  if ("openAtLogin" in o && typeof o.openAtLogin !== "boolean") return "openAtLogin must be true or false";
  return null;
}

// What tazuo-panel.json holds, with each field that is missing or invalid read as its default.
export function panelPrefsOf(v: unknown): PanelPrefs {
  const o = (v && typeof v === "object" && !Array.isArray(v)) ? v as Record<string, unknown> : {};
  const hotkey = hotkeyError(o.hotkey) ? PANEL_DEFAULTS.hotkey : o.hotkey as Hotkey;
  return {
    hotkey: { mods: HOTKEY_MODS.filter((m) => hotkey.mods.includes(m)), key: hotkey.key },
    openAtLogin: typeof o.openAtLogin === "boolean" ? o.openAtLogin : PANEL_DEFAULTS.openAtLogin,
  };
}

export function readPanelPrefs(path: string): PanelPrefs {
  try { return panelPrefsOf(JSON.parse(readFileSync(path, "utf8"))); } catch { return panelPrefsOf(null); }
}

export function writePanelPrefs(path: string, prefs: PanelPrefs, mode?: number): void {
  writeFileAtomic(path, JSON.stringify(prefs, null, 2) + "\n", mode);
}

// <TazUO>/Data/lscript.json, where <TazUO> is the folder holding the LegionScripts folder.
export function lscriptPathFor(scriptsDir: string): string {
  return join(dirname(scriptsDir), "Data", "lscript.json");
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
  const r = run("pgrep", ["-x", "TazUO"]);
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
  try { return readLscript(lscriptPathFor(scriptsDir)).list.includes(PANEL_SCRIPT); } catch { return null; }
}

// Add the panel to, or remove it from, GlobalAutoStartScripts. Merge only: the rest of the document is
// written back as it was read, with its BOM if it had one. A missing file is created holding just that
// key (TazUO fills in the rest of its defaults when it loads).
export function setGlobalAutostart(path: string, on: boolean): "unchanged" | "written" {
  const cur = readLscript(path);
  if (cur.list.includes(PANEL_SCRIPT) === on) return "unchanged";
  const list = on ? [...cur.list, PANEL_SCRIPT] : cur.list.filter((s) => s !== PANEL_SCRIPT);
  if (cur.exists) atomicReplace(`${path}.bak`, (tmp) => copyFileSync(path, tmp, constants.COPYFILE_EXCL));
  writeFileAtomic(path, (cur.bom ? "﻿" : "") + JSON.stringify({ ...cur.doc, GlobalAutoStartScripts: list }, null, 2));
  return "written";
}

export type AutostartOutcome = { status: "applied" | "unchanged" | "pending" } | { status: "error"; error: string };

// Bring lscript.json in line with the player's choice, unless a client is running (then "pending").
export function syncOpenAtLogin(scriptsDir: string, on: boolean, running: () => boolean): AutostartOutcome {
  const path = lscriptPathFor(scriptsDir);
  if (!existsSync(dirname(path))) return { status: "error", error: "No Data folder beside LegionScripts, so this does not look like a TazUO folder" };
  if (on && !existsSync(join(scriptsDir, PANEL_SCRIPT))) return { status: "error", error: `${PANEL_SCRIPT} is not installed yet: reinstall the scripts first` };
  try {
    if (readLscript(path).list.includes(PANEL_SCRIPT) === on) return { status: "unchanged" };
    if (running()) return { status: "pending" };
    return { status: setGlobalAutostart(path, on) === "written" ? "applied" : "unchanged" };
  } catch (e) { return { status: "error", error: (e as Error).message }; }
}
