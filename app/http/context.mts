// context.mts — what the route modules are built from: the config, what only the desktop shell or a test supplies, the stores and the services, all made once by startServer (app/vault-server.mts, the composition root).
import type { Config } from "../config.mts";
import type { AdapterInfo, FetchLike } from "../installer.mts";
import type { WatcherHandle } from "../watcher.mts";
import type { createMcp } from "../mcp.mts";
import type { SettingsService } from "../services/settings.mts";
import type { SetupService } from "../services/setup.mts";
import type { EventBus } from "../services/events.mts";
import type { HousesService } from "../services/houses.mts";
import type { createRetentionService } from "../services/retention.mts";
import type { JobsService } from "../services/jobs.mts";
import type { InventoryService } from "../services/inventory.mts";
import type { OrganizeService } from "../services/organize.mts";
import type { createProfilesStore } from "../store/profiles.mts";
import type { createUiPrefsStore } from "../store/ui-prefs.mts";
import type { createBlacklistStore } from "../store/blacklist.mts";
import type { createItemKindsStore } from "../store/item-kinds.mts";
import type { createOrganizeStore } from "../store/organize.mts";
import type { createOrganizeStateStore } from "../store/organize-state.mts";
import type { createRunsStore } from "../store/runs.mts";

// What only a real desktop shell (Electron) can supply to startServer — see the `host` parameter
// note in app/vault-server.mts. `title` stays `unknown` rather than `string` because it begins life as a request-body
// field: the route drops anything that is not a short string before calling, and electron/host-args
// .mts coerces it again at the far end, but the TYPE records where the value came from.
// openPath takes the DISCRIMINATOR "data" | "logs", never a resolved path: the shell owns those two
// directories and looks them up itself, so this process — the lower-trust half of the split — cannot
// name a third thing for the OS to launch (phase-7 security review, area-4 Important 1).
export interface HostBridge {
  pickFolder?: ((opts: { title?: unknown }) => Promise<string | null>) | undefined;
  openPath?: ((which: "data" | "logs") => Promise<void>) | undefined;
}

// Where the server looks for the player's game client (app/vault-server.mts's defaultClientSearch says more).
export interface ClientSearch {
  home: string;
  candidates: (adapter: AdapterInfo) => string[];
}

export interface ServerContext {
  config: Config;
  host: HostBridge | undefined;
  clientSearch: ClientSearch;
  clientRunning: () => boolean;
  updateFetch: FetchLike;
  // package.json's version and repository, as the server read it
  packageJson: { version: string; repository?: unknown };
  appSettings: SettingsService;
  setupService: SetupService;
  eventBus: EventBus;
  houseService: HousesService;
  retentionService: ReturnType<typeof createRetentionService>;
  jobService: JobsService;
  organizeService: OrganizeService;
  getInventory: InventoryService["getInventory"];
  profilesStore: ReturnType<typeof createProfilesStore>;
  uiPrefsStore: ReturnType<typeof createUiPrefsStore>;
  blacklistStore: ReturnType<typeof createBlacklistStore>;
  itemKindsStore: ReturnType<typeof createItemKindsStore>;
  organizeStore: ReturnType<typeof createOrganizeStore>;
  organizeStateStore: ReturnType<typeof createOrganizeStateStore>;
  runStore: ReturnType<typeof createRunsStore>;
  // <data>/tazuo-panel.json, and a change merged into it (app/tazuo-panel.mts)
  panelPrefsFile: string;
  savePanel: (change: object) => void;
  watchers: Map<string, WatcherHandle>;
  // the timeouts and stream pings close() must stop
  timers: Set<NodeJS.Timeout>;
  mcp: ReturnType<typeof createMcp>;
}
