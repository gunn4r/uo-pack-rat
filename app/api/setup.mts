// setup.mts — what the setup and settings routes answer and take (app/http/routes/setup.mts, settings.mts): settings.json as the server reports it, the shard's rules, the setup wizard's adapters, locate and install, the paste scanner, the update check and the retention clean-up. Types only and node-free, so the routes `satisfies` these, the page re-exports them (app/ui/api-types.mts) and the route map names them (app/api/routes.mts).
//
// map: api
// owns: `ClientSettings`, `Retention`, `SettingsData`, `SettingsApiResponse`, `SettingsPutBody`, `CleanupBody`, `CleanupApiResponse`, `ShardOption`, `RulesApiResponse`, `AdapterSummary`, `AdapterCapabilities`, `InstalledVersionInfo`, `SetupApiResponse`, `PasteScannerApiResponse`, `LocateApiResponse`, `InstallApiResponse`, `UpdateCheckApiResponse`, `LocateBody`, `InstallBody`
import type { RulesV1 } from "../schema/types.d.mts";
import type { DataDirCheckInfo } from "../data-dir-notice.mts";
import type { AutostartOutcome, PanelPrefs } from "../tazuo-panel-prefs.mts";

// ---------------------------------------------------------------- settings.json (GET/PUT /api/settings, GET /api/setup's `settings`)
// The configured game client: its adapter and the scripts folder it installed into ("" for a paste adapter).
export interface ClientSettings { adapter: string; scriptsDir: string }
// settings.json's `retention` (app/retention.mts). keepAll turns pruning off.
export interface Retention { keepAll: boolean; scanDays: number; runsPerCharacter: number }
// What the server answers for settings.json: the saved file with this run's fallbacks laid over it. The server always
// fills `retention` and `autoUpdateCheck` in (app/services/settings.mts effectiveSettings).
export interface SettingsData {
  shard: string;
  setupDone?: boolean | undefined;
  client?: ClientSettings | null | undefined;
  retention?: Retention | undefined;
  autoUpdateCheck?: boolean | undefined;   // Settings › Updates' automatic check (the server answers true unless it was turned off)
  uoFolder?: string | null | undefined;    // Settings › UO folder (house map): the folder holding tiledata.mul; absent or null = found through TazUO's launcher
  unravelKeep?: number[] | undefined;      // Inventory › Unravel's Keep list: pieces never suggested for unraveling (issue #271)
  unravelBag?: Record<string, number> | undefined;   // Inventory › Unravel's Gather into a bag: the bag each character gathers into (issue #271)
}
export interface SettingsApiResponse {
  ok: boolean;
  settings: SettingsData;
}
// What PUT /api/settings takes: any of these, each checked; `retention` merges into the saved one.
export interface SettingsPutBody {
  shard?: string;
  setupDone?: boolean;
  autoUpdateCheck?: boolean;
  client?: ClientSettings | null;
  uoFolder?: string | null;
  unravelKeep?: number[];
  unravelBag?: Record<string, number>;
  retention?: Partial<Retention>;
}
// POST /api/retention/cleanup {dryRun}: what a dry run would remove, or what a real run removed; refused when
// old scans were kept because the inventory would have changed without them.
export interface CleanupBody { dryRun: boolean }
export interface CleanupApiResponse {
  ok: boolean;
  scans: number;
  runs: number;
  refused: boolean;
}

// ---------------------------------------------------------------- GET /api/rules
// One entry of `available` (app/rules.mts listRules): a shard's rules file, built in or the player's own override.
export interface ShardOption {
  id: string;
  name: string;
  source: "builtin" | "user";
  path: string;
}
export interface RulesApiResponse {
  ok: boolean;
  shard: string;
  rules: RulesV1;
  available: ShardOption[];
  fallback: boolean;
}

// ---------------------------------------------------------------- the setup wizard (GET /api/setup and the rest of /api/setup)
// One entry of GET /api/setup's `adapters`: app/installer.mts's AdapterInfo, less the script names the page never reads.
export interface AdapterSummary {
  id: string;
  name: string;
  transport: string;
  platform: string | null;
  summary: string;
  capabilities: AdapterCapabilities;
  features: string[];
}
// capabilities.json's `capabilities` object as listAdapters reads it: `bridge` always a list of action names ([] when
// the file has none or not a list); the rest as the file wrote it.
export interface AdapterCapabilities { bridge: string[]; [key: string]: unknown }
// Which of an adapter's scripts a folder holds, and the scanner's version among them (app/installer.mts installedVersion).
export interface InstalledVersionInfo {
  version: string | null;
  files: Record<string, boolean>;
}
export type { DataDirCheckInfo };
export interface SetupApiResponse {
  ok: boolean;
  firstRun: boolean;
  settings: SettingsData;
  adapters: AdapterSummary[];
  candidates: Record<string, string[]>;
  installed: InstalledVersionInfo | null;
  available: Record<string, string | null>;
  dataDir: string;
  platform: string;
  bridgeAdapter: string | null;
  dataDirCheck: DataDirCheckInfo;
  version?: string | undefined;   // package.json's version (Settings › Updates)
  canOpenFolders?: boolean | undefined;   // the desktop shell can open a folder (POST /api/host/open-path)
}
// GET /api/setup/scanner?adapter=<id> — a paste-transport adapter's bundled scanner (installer.mts's pasteScanner).
export interface PasteScannerApiResponse {
  ok: boolean;
  version: string | null;
  script: string;
}
// POST /api/setup/locate {adapter, dir}: the scripts folder found there, and what it holds.
export interface LocateApiResponse {
  ok: boolean;
  scriptsDir: string;
  installed: InstalledVersionInfo;
}
// POST /api/setup/install {adapter, scriptsDir, panel?} — installer.mts's InstallScriptsResult's `ok: true` branch (a
// refusal is a non-2xx answer, which api.mts throws on), plus what the route adds: `scriptsDir`, the folder the server
// resolved out of what the page sent (a client root becomes its nested scripts folder), `pathsFile`, what became of
// packrat-paths.json (installer.mts's PathsFileOutcome; ui/messages.mts turns it into a sentence), and `autostart`.
export interface InstallApiResponse {
  ok: boolean;
  installed: string[];
  version: string | null;
  scriptsDir?: string | undefined;
  pathsFile?: string | undefined;
  autostart?: AutostartOutcome | null | undefined;
}
export interface LocateBody { adapter: string; dir: string }
export interface InstallBody { adapter: string; scriptsDir: string; panel?: PanelPrefs }

// ---------------------------------------------------------------- GET /api/update-check
// app/installer.mts's CheckForUpdatesResult, flattened. `url` is checkForUpdates()'s releaseUrl(): GitHub's html_url
// once it has been proved an https://github.com/<this repo>/releases… address, else the repository's releases page.
export interface UpdateCheckApiResponse {
  ok: true;
  configured: boolean;
  error?: string | undefined;
  current?: string | undefined;
  latest?: string | undefined;
  url?: string | undefined;
  upToDate?: boolean | undefined;
}
