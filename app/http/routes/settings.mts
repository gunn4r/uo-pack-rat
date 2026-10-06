// settings.mts — GET|PUT /api/settings, POST /api/retention/cleanup and GET /api/rules.
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isBoundedString } from "../../guards.mts";
import { validateScriptsDir, badPathShape } from "../../installer.mts";
import { readBody } from "../../read-body.mts";
import { retentionError, retentionOf } from "../../retention.mts";
import { loadRules, listRules } from "../../rules.mts";
import type { ClientSettings, SettingsDoc } from "../../store/settings.mts";
import { send, asObject } from "../respond.mts";
import { MAX_PATH_LEN, NO_CLIENT_FOLDER } from "./setup.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

const NO_TILEDATA = "no tiledata.mul found in that folder";

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, appSettings, retentionService, setupService } = ctx;
  const USER_RULES_DIR = CONFIG.paths.rules;
  return [
    { method: "GET", path: "/api/settings", handle: (_req, res) => send(res, 200, { ok: true, settings: appSettings.current() }) },
    { method: "PUT", path: "/api/settings", handle: async (req, res) => {
      // Any subset of {shard, setupDone, client} — Task 2 extended this route to carry the setup
      // wizard's own state without disturbing the shard-switch contract above it. Each field present
      // in the body is validated before ANYTHING is written (load-then-persist, same reasoning as
      // before: a rejected field must never partially land on disk or in memory), and every field is
      // now checked POSITIVELY — a string is a bounded string, a folder is a folder this server is
      // willing to read (post-review fix, area-3 finding 3: client.scriptsDir used to be persisted on
      // a bare typeof check, after which GET /api/setup readdir/readFileSync'd whatever it named on
      // every page load, hanging the whole single-threaded process on a FIFO and dialling out over
      // SMB for a UNC path). These three are the only fields this route persists.
      const body = asObject(await readBody(req));
      let nextRules = appSettings.rules(), nextFallback = appSettings.rulesFallback();
      const hasShard = Object.prototype.hasOwnProperty.call(body, "shard");
      if (hasShard) {
        if (!isBoundedString(body.shard, 64)) return send(res, 400, { ok: false, error: "settings.shard must be a string" });
        try { nextRules = loadRules(body.shard, { userRulesDir: USER_RULES_DIR }); }
        catch { return send(res, 400, { ok: false, error: `unknown or invalid shard: ${body.shard}` }); }
        nextFallback = false;
      }
      if (Object.prototype.hasOwnProperty.call(body, "setupDone") && typeof body.setupDone !== "boolean") {
        return send(res, 400, { ok: false, error: "settings.setupDone must be a boolean" });
      }
      if (Object.prototype.hasOwnProperty.call(body, "autoUpdateCheck") && typeof body.autoUpdateCheck !== "boolean") {
        return send(res, 400, { ok: false, error: "settings.autoUpdateCheck must be a boolean" });
      }
      const hasRetention = Object.prototype.hasOwnProperty.call(body, "retention");
      const retentionBad = hasRetention ? retentionError(body.retention) : null;
      if (retentionBad) return send(res, 400, { ok: false, error: retentionBad });
      // undefined = the body said nothing about the client and the persisted one is left alone;
      // null = clear it (an explicit null, or a folder-transport client with an empty scriptsDir); an
      // object = a validated, RESOLVED {adapter, scriptsDir}. A paste-transport client has no scripts
      // folder, so it is kept with scriptsDir "" — what the wizard's finish() sends for one.
      let nextClient: ClientSettings | null | undefined;
      if (Object.prototype.hasOwnProperty.call(body, "client")) {
        const c = body.client;
        if (c === null) nextClient = null;
        else {
          const rec = (c && typeof c === "object" && !Array.isArray(c)) ? c as Record<string, unknown> : null;
          if (!rec || !isBoundedString(rec.adapter, 64) || typeof rec.scriptsDir !== "string" || rec.scriptsDir.length > MAX_PATH_LEN) {
            return send(res, 400, { ok: false, error: "settings.client must be null or {adapter, scriptsDir}" });
          }
          const adapter = rec.adapter;
          // Security (post-review fix): client.adapter must be a real, known adapter id before it can
          // ever reach installer.mts's path.join calls — see the /api/setup/install note below.
          const info = setupService.adapters().find((a) => a.id === adapter);
          if (!info) {
            return send(res, 400, { ok: false, error: `settings.client.adapter: unknown adapter "${adapter}"` });
          }
          if (info.transport === "paste") nextClient = { adapter, scriptsDir: "" };
          else if (!rec.scriptsDir.trim()) nextClient = null;
          else {
            // The same acceptance POST /api/setup/locate applies, so the wizard and a hand-written
            // settings PUT can never disagree about what a scripts folder is — and the RESOLVED
            // path is what gets persisted, not the raw body value.
            const located = validateScriptsDir(rec.scriptsDir, adapter, setupService.adaptersDir);
            if (!located.ok) return send(res, 400, { ok: false, error: `settings.client.scriptsDir: ${NO_CLIENT_FOLDER}` });
            nextClient = { adapter, scriptsDir: located.scriptsDir };
          }
        }
      }
      // uoFolder (issue #10): the folder the house map reads tiledata.mul from, or null for automatic (TazUO's launcher). Checked like the client folder: a bounded string of an absolute, non-UNC shape before any filesystem call (installer.mts's badPathShape: a UNC path's first stat is an outbound SMB connection), then a folder holding a tiledata.mul file. The error never echoes the path.
      let nextUoFolder: string | null | undefined;
      if (Object.prototype.hasOwnProperty.call(body, "uoFolder")) {
        const v = body.uoFolder;
        if (v === null) nextUoFolder = null;
        else {
          if (!isBoundedString(v, MAX_PATH_LEN) || badPathShape(v)) return send(res, 400, { ok: false, error: "settings.uoFolder must be null or the full path of a folder" });
          const dir = resolve(v);
          let found = false;
          try { found = statSync(dir).isDirectory() && statSync(join(dir, "tiledata.mul")).isFile(); } catch { found = false; }
          if (!found) return send(res, 400, { ok: false, error: `settings.uoFolder: ${NO_TILEDATA}` });
          nextUoFolder = dir;
        }
      }
      // Only the fields this request carried reach settings.json (saveSettings): a startup fallback
      // for a field it did not name stays in memory, where it belongs.
      const changes: Partial<SettingsDoc> = {};
      if (hasShard) changes.shard = body.shard as string;
      if (Object.prototype.hasOwnProperty.call(body, "setupDone")) changes.setupDone = body.setupDone as boolean;
      if (Object.prototype.hasOwnProperty.call(body, "autoUpdateCheck")) changes.autoUpdateCheck = body.autoUpdateCheck as boolean;
      if (nextClient !== undefined) changes.client = nextClient;
      if (nextUoFolder !== undefined) changes.uoFolder = nextUoFolder;
      if (hasRetention) changes.retention = { ...retentionOf(appSettings.saved().retention), ...(body.retention as object) };
      appSettings.save(changes);
      appSettings.applyRules(nextRules, nextFallback);
      return send(res, 200, { ok: true, settings: appSettings.current() });
    } },
    { method: "POST", path: "/api/retention/cleanup", handle: async (req, res) => {
      // Settings › Data's Clean up now: {dryRun: true} counts what the pruning would remove (the
      // confirm dialog's sentence), {dryRun: false} removes it and says what went.
      // `refused`: old scans were kept because the inventory would have changed without them.
      const { dryRun } = asObject(await readBody(req, { limit: 8e3 }));
      if (typeof dryRun !== "boolean") return send(res, 400, { ok: false, error: "dryRun must be a boolean" });
      if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
      if (dryRun) { const plan = await retentionService.plan(); return send(res, 200, { ok: true, scans: plan.scans.length, runs: plan.runs.length, refused: plan.refused }); }
      return send(res, 200, { ok: true, ...await retentionService.prune("clean up now") });
    } },
    { method: "GET", path: "/api/rules", handle: (_req, res) => {
      return send(res, 200, { ok: true, shard: appSettings.current().shard, rules: appSettings.rules(), available: listRules({ userRulesDir: USER_RULES_DIR }), fallback: appSettings.rulesFallback() });
    } },
  ];
}
