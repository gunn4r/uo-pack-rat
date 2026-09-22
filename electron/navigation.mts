// navigation.mts — the two decisions electron/main.mts makes about where the page may go: whether a
// navigation stays on the local server's origin, and whether a link the page tries to open in a new
// window may be handed to the OS browser. Both inputs are page-controlled, so both are guards.
//
// They live in their own module for the same reason as host-args.mts: main.mts imports `electron` at
// the top level and cannot be loaded by a plain `node:test` process, so pulling the pure decisions out
// is what lets scripts/electron-guards.test.mts check what they decide instead of matching main.mts's
// source text (which kept matching with every one of these guards switched off). Nothing else belongs
// here: this module stays dependency-free and side-effect-free, and main.mts owns the clock, the log
// and the actual OS call.

// Bound, scheme and rate limit on anything the page asks the OS browser to open. No host allowlist:
// the one external link the UI has today is the "View release" GitHub URL in app/ui/settings.mts, and
// that value is host-checked where it is born (app/installer.mts, which owns the GitHub API response)
// — a second list here would silently break the next legitimate link (a wiki page, an issue URL)
// without adding a control the born-side check doesn't already give.
export const MAX_EXTERNAL_URL = 2048;
export const EXTERNAL_OPEN_GAP_MS = 1000;

// `open` is the parsed, normalised href — the only value main.mts hands to shell.openExternal.
// `refused` finishes the log line "window-open: refused …" (or reads "throttled").
export type ExternalOpenDecision = { open: string } | { refused: string };

// `now` and `lastOpen` are main.mts's clock readings; `lastOpen` is null until a link has been opened,
// and main.mts records `now` as the new `lastOpen` only when this returns `open`.
export function externalOpenDecision(url: unknown, now: number, lastOpen: number | null): ExternalOpenDecision {
  if (typeof url !== "string") return { refused: "a url that is not a string" };
  if (url.length > MAX_EXTERNAL_URL) return { refused: `a ${url.length}-character url` };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { refused: "an unparsable url" };
  }
  // https only — every real link this app produces is https, and http: buys a MITM a second bite at a
  // URL the user already trusts enough to click.
  if (parsed.protocol !== "https:") return { refused: `scheme ${parsed.protocol}` };
  // One tab per second at most, so page code cannot drive window.open in a loop and launch unbounded
  // browser tabs (or unbounded external-app launches) behind a single user click.
  if (lastOpen !== null && now - lastOpen < EXTERNAL_OPEN_GAP_MS) return { refused: "throttled" };
  return { open: parsed.href };
}

// `origin` on a refusal is what main.mts logs: the target's origin, or "unparsable".
export type NavigationDecision = { allowed: true } | { allowed: false; origin: string };

// `currentOrigin` is null until the server child has said which port it bound, and nothing is allowed
// before then (an unparsable url must not compare equal to a null origin and slip through).
export function navigationDecision(url: string, currentOrigin: string | null): NavigationDecision {
  // devtools:// is Chromium's own frontend navigating itself — a webContents this guard also sees,
  // since main.mts attaches it to every one of them rather than only the window it creates.
  if (url.startsWith("devtools://")) return { allowed: true };
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { allowed: false, origin: "unparsable" };
  }
  return currentOrigin !== null && origin === currentOrigin ? { allowed: true } : { allowed: false, origin };
}
