// ui/theme.mts — the look: which theme family and light/dark mode <html> carries (data-theme, data-mode;
// app/ui/tokens.css reads both). The choice is the ui-prefs "theme" and "appearance" fields; "system"
// follows prefers-color-scheme live, so switching the OS to dark flips an open page. Pure resolution is
// split from the DOM so app/theme.test.mts can run it under plain node:test.
import type { UiPrefs } from "./api-types.mts";

export type Appearance = "light" | "system" | "dark";
export type Mode = "light" | "dark";
// The theme families whose tokens ship (Default in tokens.css, Britannia in britannia.css). The server may
// store a family the page does not know; the page draws the default look for it.
export const BUILT_THEMES = ["default", "britannia"] as const;
export const DEFAULT_APPEARANCE: Appearance = "system";

export function resolveTheme(theme: string | null | undefined): string {
  return (BUILT_THEMES as readonly string[]).includes(theme || "") ? theme! : "default";
}
export function resolveAppearance(appearance: string | null | undefined): Appearance {
  return appearance === "light" || appearance === "dark" || appearance === "system" ? appearance : DEFAULT_APPEARANCE;
}
export function resolveMode(appearance: string | null | undefined, prefersDark: boolean): Mode {
  const a = resolveAppearance(appearance);
  return a === "system" ? (prefersDark ? "dark" : "light") : a;
}

// The current choice, kept so a prefers-color-scheme change can re-resolve "system" without asking the
// server again.
const current: { theme: string; appearance: Appearance } = { theme: "default", appearance: DEFAULT_APPEARANCE };
let media: MediaQueryList | null = null;

function paint(): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(current.theme);
  root.dataset.mode = resolveMode(current.appearance, !!media?.matches);
  root.dataset.appearance = current.appearance;
}

// Called once at module load of app.mts (before any data arrives, so the first paint is already in the
// right mode), then again with the saved prefs.
export function applyLook(prefs: Pick<UiPrefs, "theme" | "appearance"> | null): void {
  if (!media && typeof matchMedia === "function") {
    media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", () => { if (current.appearance === "system") paint(); });
  }
  current.theme = prefs?.theme || current.theme;
  current.appearance = resolveAppearance(prefs?.appearance ?? current.appearance);
  paint();
}
export function currentLook(): { theme: string; appearance: Appearance } { return { ...current }; }
