// ui/tazuo-panel.mts — the two options of the TazUO in-game panel (app/tazuo-panel.mts): whether it
// shows its window at login, and its show/hide hotkey. Settings › Game client saves each change as it is made; the wizard's
// install step shows the same controls and sends the choices with the install.
import { box, check, select } from "./components.mts";
import type { AutostartOutcome, PanelHotkey, PanelPrefs } from "./api-types.mts";

export const PANEL_DEFAULTS: PanelPrefs = { hotkey: { mods: ["CTRL", "SHIFT"], key: "P" }, showAtLogin: true };
const MODS = [["CTRL", "SHIFT"], ["CTRL", "ALT"], ["ALT", "SHIFT"], ["CTRL", "ALT", "SHIFT"], ["CTRL"], ["ALT"], ["SHIFT"], []];
const KEYS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""), ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)];
const title = (m: string): string => m.charAt(0) + m.slice(1).toLowerCase();
export const hotkeyLabel = (h: PanelHotkey): string => [...h.mods.map(title), h.key].join("+");

export function panelControls(prefs: PanelPrefs, onChange: (change: Partial<PanelPrefs>) => void, id: string): { login: HTMLElement; hotkey: HTMLElement } {
  const login = check({ label: "Show the Pack Rat panel at login", sw: true, checked: prefs.showAtLogin, attrs: { id: `${id}-login` },
    onChange: (on) => onChange({ showAtLogin: on }) });
  const mods = select(MODS.map((m) => ({ value: m.join("+"), label: m.length ? m.map(title).join("+") : "No modifier" })), prefs.hotkey.mods.join("+"),
    { size: "sm", attrs: { id: `${id}-mods`, "aria-label": "Hotkey modifiers" } });
  const key = select(KEYS.map((k) => ({ value: k, label: k })), prefs.hotkey.key, { size: "sm", attrs: { id: `${id}-key`, "aria-label": "Hotkey key" } });
  const changed = (): void => onChange({ hotkey: { mods: mods.value ? mods.value.split("+") : [], key: key.value } });
  mods.addEventListener("change", changed);
  key.addEventListener("change", changed);
  return { login: login.root, hotkey: box("div", { class: "set-inline" }, mods, key) };
}

// What an install did about starting the panel with TazUO, for a note under the result; null when there is nothing to say.
export function autostartNote(a: AutostartOutcome | null | undefined): { tone: "ok" | "warn" | "bad"; text: string } | null {
  if (!a || a.status === "unchanged") return null;
  if (a.status === "applied") return { tone: "ok", text: "The Pack Rat panel now starts every time you start TazUO." };
  if (a.status === "running") return { tone: "warn", text: "TazUO is open, so the panel was not added to its autostart list. Quit TazUO and reinstall, or check Autostart for packrat-panel.py in the Script Manager." };
  return { tone: "bad", text: `Could not add the panel to TazUO's autostart list: ${"error" in a ? a.error : "unknown error"}` };
}
