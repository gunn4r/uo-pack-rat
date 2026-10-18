// panel-prefs.mts — <data>/tazuo-panel.json (app/tazuo-panel-prefs.mts): whether the TazUO in-game panel shows at login and its show/hide hotkey, which the app (Settings, the wizard) and the panel's own button both write and the panel re-reads.
//
// map: server
// owns: `createPanelPrefsStore`, `readPanelPrefs`, `writePanelPrefs`
import { readBounded, writeFileAtomic } from "../atomic-write.mts";
import { DATA_FILE_MODE } from "../config.mts";
import { panelPrefsOf, type PanelPrefs } from "../tazuo-panel-prefs.mts";
import { updater } from "./json-file.mts";

// The in-game panel writes tazuo-panel.json too, so it is read as untrusted: capped, each field validated.
const MAX_PANEL_FILE_BYTES = 4096;   // the size packrat-panel.py reads too (MAX_PREFS_BYTES)
export function readPanelPrefs(path: string): PanelPrefs {
  let raw: unknown = null;
  try { const r = readBounded(path, MAX_PANEL_FILE_BYTES); if (!r.tooBig) raw = JSON.parse(r.text); } catch { /* missing or unreadable: the defaults */ }
  return panelPrefsOf(raw);
}
// Written normalised: only hotkey and showAtLogin reach the file.
export function writePanelPrefs(path: string, prefs: object, mode?: number): void {
  writeFileAtomic(path, JSON.stringify(panelPrefsOf(prefs), null, 2) + "\n", mode);
}

// save(change) merges a change (fields panelPrefsError has checked) over the prefs as they are on disk now.
export function createPanelPrefsStore(file: string) {
  const read = (): PanelPrefs => readPanelPrefs(file);
  const update = updater(read, (next: PanelPrefs) => writePanelPrefs(file, next, DATA_FILE_MODE));
  const save = (change: object): void => { update((prefs) => ({ ...prefs, ...change })); };
  return { file, read, save };
}
