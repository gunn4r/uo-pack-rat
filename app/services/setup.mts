// setup.mts — the adapters this install ships and what the client setup needs of them: which ids are real, which bridge runs Organize trips, and whether the client's installed scripts write to this data folder.
import { listAdapters, checkScriptsDataDir, type AdapterInfo, type DataDirCheck } from "../installer.mts";
import type { ClientSettings } from "../store/settings.mts";

// The registry is read from disk on every call, as the routes always have: an adapter folder added or edited while
// the app runs is seen at once. `clientSearch` is where the server looks for the game client's scripts.
export function createSetupService({ adaptersDir, dataDir, demo, clientSearch }: {
  adaptersDir: string;
  dataDir: string;
  demo: boolean;
  clientSearch: { home: string; candidates: (adapter: AdapterInfo) => string[] };
}) {
  const adapters = (): AdapterInfo[] => listAdapters(adaptersDir);
  const isKnown = (id: unknown): boolean => adapters().some((a) => a.id === id);
  // Whether this adapter's bridge declares the "trip" capability (Organize trips and Put away).
  const runsTrips = (adapter: string): boolean => {
    const caps = adapters().find((a) => a.id === adapter)?.capabilities as { bridge?: unknown } | undefined;
    return Array.isArray(caps?.bridge) && caps.bridge.includes("trip");
  };
  // Whether the client's installed scripts write to this data folder (installer.mts's
  // checkScriptsDataDir). Run on every GET /api/setup, so a reinstall clears the page's banner with no
  // restart, and once at startup, so a plain `npm start` on the default folder against scripts pointed at a
  // dev folder says so in the terminal instead of just showing nothing. Never under --demo: its
  // fixtures don't come from any client. The sentence is the page's own (ui/messages.mts).
  function dataDirCheck(client: ClientSettings | null | undefined): DataDirCheck {
    if (demo) return { status: "none" };
    const candidates = client ? [] : adapters().flatMap((a) => clientSearch.candidates(a));
    return checkScriptsDataDir({ dataDir, client, candidates, home: clientSearch.home, platform: process.platform });
  }
  return { adaptersDir, adapters, isKnown, runsTrips, dataDirCheck };
}
export type SetupService = ReturnType<typeof createSetupService>;
