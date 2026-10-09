// settings.mts — the settings this run uses and the shard's rules: settings.json as saved, with the two startup fallbacks laid over it, and the rules that settings.json names, handed to vault-lib.
import { loadRules, DEFAULT_SHARD } from "../rules.mts";
import { retentionOf } from "../retention.mts";
import { rulesUpgradeNote, setRules } from "../vault-lib.mts";
import type { RulesV1 } from "../schema/types.d.mts";
import type { SettingsDoc } from "../store/settings.mts";
import { short } from "../guards.mts";

// `store` is settings.json's store; `rulesDir` the data folder's rules overrides; `isKnownAdapter` says whether this
// install ships an adapter id; `warn` is the server's startup warning (the console and the log).
export function createSettingsService({ store, rulesDir, isKnownAdapter, warn }: {
  store: { load(): SettingsDoc; write(doc: SettingsDoc): void };
  rulesDir: string;
  isKnownAdapter: (id: string) => boolean;
  warn: (msg: string) => void;
}) {
  // A persisted client whose adapter id is not one this install ships is dropped IN MEMORY ONLY (the
  // same rule as the shard fallback below — settings.json is left as it stands): bridgeAdapter()
  // joins that id into the bridge queue/status paths, and PUT /api/settings already refuses an
  // unknown one, so a hand-edited file must not be a way round that check.
  function clientIsKnown(doc: SettingsDoc): boolean {
    const client = doc.client as unknown;
    if (client == null) return true;
    const rec = typeof client === "object" && !Array.isArray(client) ? client as Record<string, unknown> : null;
    const known = !!rec && typeof rec.adapter === "string" && typeof rec.scriptsDir === "string" && isKnownAdapter(rec.adapter);
    if (!known) warn(`settings.json names a client adapter this install does not ship (${JSON.stringify(short(rec?.adapter))}); ignoring that client for this run — settings.json is unchanged`);
    return known;
  }
  // Two views of the same settings. savedSettings is exactly what settings.json holds, and the only
  // thing ever written back to it; currentSettings is what this run actually uses — savedSettings
  // with the two startup fallbacks (an unknown client dropped, an unloadable shard replaced) laid on
  // top. Every write merges only the fields its request changed into savedSettings, so a fallback
  // can never be persisted over the player's real value by an unrelated save (a wizard's setupDone,
  // say): fixing the rules file or reinstalling the newer version and restarting picks the original
  // choice back up, as the fallback promises.
  let savedSettings = store.load();
  let clientIgnored = !clientIsKnown(savedSettings);
  // The shard fallback below sets this; declared here so effectiveSettings() can read it.
  let rulesFallback = false;
  function effectiveSettings(): SettingsDoc {
    return { ...savedSettings, retention: retentionOf(savedSettings.retention), autoUpdateCheck: savedSettings.autoUpdateCheck !== false, ...(clientIgnored ? { client: null } : {}), ...(rulesFallback ? { shard: DEFAULT_SHARD } : {}) };
  }
  let currentSettings = effectiveSettings();
  // The app must never fail to start because settings.json names a shard that no longer loads (its
  // rules file was deleted, edited into invalid shape, or never existed — e.g. a stale user override).
  // Fall back to DEFAULT_SHARD IN MEMORY ONLY: settings.json itself is left untouched, so fixing the
  // named shard's rules file and restarting picks the original choice back up. GET /api/rules reports
  // this as `fallback: true` so the page can tell the user rather than silently serving a different
  // shard than settings.json names.
  let currentRules: RulesV1;
  try {
    currentRules = loadRules(currentSettings.shard, { userRulesDir: rulesDir });
  } catch (e) {
    const msg = `settings.json names shard "${currentSettings.shard}", which failed to load (${(e as Error).message}); falling back to "${DEFAULT_SHARD}" for this run — settings.json is unchanged`;
    warn(msg);
    currentRules = loadRules(DEFAULT_SHARD, { userRulesDir: rulesDir });
    rulesFallback = true;
    currentSettings = effectiveSettings();
  }
  // vault-lib is one module instance for the whole process (the server, organize, buffs, missing, the MCP tools…), and
  // it holds the shard's rules: hand them over here and again wherever currentRules changes (PUT /api/settings).
  setRules(currentRules);
  const upgradeWarning = (rules: RulesV1): void => { const note = rulesUpgradeNote(rules); if (note) warn(note); };
  upgradeWarning(currentRules);

  // Merges only the fields a request changed into what settings.json holds, and writes it.
  function save(changes: Partial<SettingsDoc>): void {
    const next: SettingsDoc = { ...savedSettings, schemaVersion: 1, ...changes };
    store.write(next);
    savedSettings = next;
    if ("client" in changes) clientIgnored = false;
    currentSettings = effectiveSettings();
  }
  // A shard switch (PUT /api/settings): the rules it loaded, and whether they are the startup fallback still.
  function applyRules(rules: RulesV1, fallback: boolean): void {
    currentRules = rules;
    setRules(currentRules);
    upgradeWarning(rules);
    rulesFallback = fallback;
    currentSettings = effectiveSettings();
  }
  // Which adapter's bridge the page-facing bridge routes (POST /api/bridge, GET /api/bridge/status)
  // talk to — the currently CONFIGURED client, re-read live off currentSettings on every call rather
  // than captured once at startup, so a client switch (a fresh install, or "Run setup again") takes
  // effect on the very next request with no restart. Falls back to DEFAULT_BRIDGE_ADAPTER when no
  // client is configured at all, matching this route's own pre-existing behavior before it became
  // per-adapter (Phase 6 final review follow-up). GET /api/setup reports this exact same id back
  // to the page as `bridgeAdapter` (guarded there against a discovered-adapters list that doesn't
  // actually contain it — a throwaway test fixture dir, say) so app/ui/bridge.mts's currentAdapter()
  // can show the Highlight/Grab/Go-to buttons for an unconfigured/hand-installed player against the
  // SAME adapter this function is already routing their commands to, rather than the page guessing
  // "tazuo" independently and risking the two disagreeing.
  const DEFAULT_BRIDGE_ADAPTER = "tazuo";
  const bridgeAdapter = (): string => currentSettings.client?.adapter || DEFAULT_BRIDGE_ADAPTER;

  return {
    current: (): SettingsDoc => currentSettings,
    saved: (): SettingsDoc => savedSettings,
    rules: (): RulesV1 => currentRules,
    rulesFallback: (): boolean => rulesFallback,
    save, applyRules, bridgeAdapter,
  };
}
export type SettingsService = ReturnType<typeof createSettingsService>;
