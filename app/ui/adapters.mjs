// ui/adapters.mjs — pure adapter-selection helpers shared by the wizard and the Import tab. No DOM
// or app/ui/store.mjs dependency (unlike most of ui/*.mjs, which touch localStorage/document at
// module scope and so can only run in a real browser or under Playwright) — kept separate on purpose
// so it can be unit-tested directly under plain node:test. See app/wizard-default-adapter.test.mjs.

// Whether `adapter` can run at all on `platform` — driven entirely by the adapter's OWN data
// (`a.platform`, from `capabilities.json`'s optional top-level `platform` field, surfaced by
// app/installer.mts's listAdapters), never by hard-coding an adapter id here. Razor Enhanced sets
// `platform: "win32"` (it's a Windows-only client, per its own README); no other shipped adapter
// restricts itself, so `a.platform` is null/absent for them and this always returns true. `platform`
// is GET /api/setup's own `platform` field — the server's `process.platform`, which on this desktop
// app is always the same machine the player's game client runs on. Offering an incompatible adapter
// as a choice with no explanation, or worse, silently defaulting to it, points a player at scripts
// nothing on their machine can ever run — the Phase 6 final review flagged exactly this ("the
// wizard's client list is not platform-filtered, so a Mac player can pick the Windows-only adapter")
// as a must-fix-before-merge item. The wizard/Import tab still SHOW an incompatible adapter (so a
// player who's heard of it isn't left wondering why it's missing) but disable choosing it and say
// why — see wizard.mjs's step2() and import.mjs's adapterPicker() — while defaultAdapterId (below)
// is never handed one, so the app never silently lands a player on a client that can't work for them.
export function platformCompatible(adapter, platform) {
  return !adapter?.platform || adapter.platform === platform;
}
// The adapters actually worth silently DEFAULTING to on this platform — what defaultAdapterId (below)
// chooses among. Not what the wizard/Import tab RENDER: those show every shipped adapter and disable
// the platform-incompatible ones in place (platformCompatible, above, drives that per-adapter), so a
// player always sees the full list and why one entry isn't chooseable here.
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
