// server-fixture.mts — test fixture: startTestServer starts the real server the way every server test file needs it, with no reach outside the test. The server looks for the game client's scripts (GET /api/setup's candidates, and the data-folder check at startup and on every GET /api/setup, which reads the packrat-paths.json it finds). No test may reach a real client folder, so every server here gets an empty temp home to search, with the platform pinned to one that has no fixed-path roots (candidateClientRoots adds C:\TazUO on win32), and never shells out to pgrep/tasklist to ask whether the client runs. Nor may any test reach GitHub: GET /api/update-check asks through fakeUpdateFetch, which answers one fixed release and records every URL it is asked for. A real request that stalled on a CI runner was aborted after 10 s, but the lookup it was waiting on kept the file running past its last test (#125).
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer, type ServerHandle, type StartServerOptions } from "./vault-server.mts";
import { candidateClientRoots, type FetchLike } from "./installer.mts";
import type { Config } from "./config.mts";

export const FAKE_HOME = mkdtempSync(join(tmpdir(), "qm-home-"));

export const updateRequests: string[] = [];
const fakeUpdateFetch: FetchLike = async (url) => {
  updateRequests.push(url);
  return { status: 200, json: async () => ({ tag_name: "v99.0.0" }) };
};

// opts override the fakes field by field, as a test that needs a running client does with clientRunning.
export function startTestServer(config: Config, opts: StartServerOptions = {}): Promise<ServerHandle> {
  return startServer(config, {
    clientSearch: { home: FAKE_HOME, candidates: (a) => candidateClientRoots({ adapter: a.id, home: FAKE_HOME, platform: "linux", env: {}, adapterPlatform: a.platform }) },
    clientRunning: () => false,
    updateFetch: fakeUpdateFetch,
    ...opts,
  });
}
