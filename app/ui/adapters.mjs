// ui/adapters.mjs — pure adapter-selection helpers shared by the wizard and the Import tab. No DOM
// or app/ui/store.mjs dependency (unlike most of ui/*.mjs, which touch localStorage/document at
// module scope and so can only run in a real browser or under Playwright) — kept separate on purpose
// so it can be unit-tested directly under plain node:test. See app/wizard-default-adapter.test.mjs.

// Razor Enhanced is Windows-only (its own README's first line; app/installer.mjs's
// candidateClientRoots already gates its candidate-path guess the same way: `adapter ===
// "razor-enhanced" && platform !== "win32"` returns no candidate). No other shipped adapter is
// platform-restricted today. Offering it as a choice — or worse, silently defaulting to it — on any
// other platform points a player at scripts nothing on their machine can ever run: the Phase 6 final
// review flagged exactly this ("the wizard's client list is not platform-filtered, so a Mac player
// can pick the Windows-only adapter") as a must-fix-before-merge deferred minor. `platform` is
// GET /api/setup's own `platform` field (added alongside this fix) — the server's `process.platform`,
// which on this desktop app is always the same machine the player's game client runs on.
export function platformCompatible(adapter, platform) {
  return !(adapter?.id === "razor-enhanced" && platform !== "win32");
}
// The adapters actually worth offering on this platform — what the wizard's radio list and the
// Import tab's picker both render, and what defaultAdapterId (below) should be choosing among.
export function availableAdapters(adapters, platform) {
  return (adapters || []).filter((a) => platformCompatible(a, platform));
}

// A sensible default when nothing has picked an adapter yet (no configured client, no explicit
// choice): the first folder-transport ("installable") adapter, never a paste-transport one. Without
// this, defaulting to adapters[0] picks whichever adapter's directory name sorts first
// alphabetically — today that's classicuo-web, a paste-transport client — and a new TazUO or Razor
// Enhanced player who clicks through the setup wizard without reading the radio buttons ends up
// routed down the paste branch, with that silently persisted as their client (Phase 6 final review,
// Blocker 2). Falls back to the first adapter of any transport only if every shipped adapter happens
// to be paste-transport (so the wizard/Import tab still has *something* selected rather than null).
// Callers MUST pass an already platform-filtered list (availableAdapters, above) — this function has
// no platform of its own to filter by, and "razor-enhanced" < "tazuo" alphabetically, so an
// unfiltered list would default a non-Windows player to the one adapter that can never work for them.
export function defaultAdapterId(adapters) {
  if (!adapters || !adapters.length) return null;
  return (adapters.find((a) => a.transport !== "paste") || adapters[0]).id;
}
