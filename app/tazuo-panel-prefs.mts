// tazuo-panel-prefs.mts — the TazUO panel's options and their validation, with no Node imports, so the
// page's types (app/ui/api-types.mts) can share them. The file side is app/tazuo-panel.mts.
export const HOTKEY_MODS = ["CTRL", "ALT", "SHIFT"] as const;
export const HOTKEY_KEYS: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
];
export interface Hotkey { mods: string[]; key: string }
export interface PanelPrefs { hotkey: Hotkey; openAtLogin: boolean }
export const PANEL_DEFAULTS: PanelPrefs = { hotkey: { mods: ["CTRL", "SHIFT"], key: "P" }, openAtLogin: true };

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

// What became of "open at login" after a request (app/tazuo-panel.mts's syncOpenAtLogin).
export type AutostartOutcome = { status: "applied" | "unchanged" | "pending" } | { status: "error"; error: string };
