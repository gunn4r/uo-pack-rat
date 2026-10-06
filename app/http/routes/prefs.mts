// prefs.mts — the player's saved choices: GET|PUT /api/profiles, /api/ui-prefs and /api/tazuo-panel.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBuffList, isBuffSkills } from "../../buffs.mts";
import { PROFILES_VERSION, profilesSpecError, type ProfilesV3 } from "../../build-spec.mts";
import { isBoundedString } from "../../guards.mts";
import { readBody } from "../../read-body.mts";
import { validate, type ValidatorSchema } from "../../schema/validate.mts";
import { isColWidths, isDrawerWidth, isManualSuit, UI_PREF_CHOICES, UI_PREF_LISTS, UI_PREF_VERSIONS } from "../../store/ui-prefs.mts";
import { panelPrefsError, readPanelPrefs } from "../../tazuo-panel.mts";
import { send, asObject } from "../respond.mts";
import { APP_DIR } from "../../config.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

const HERE = APP_DIR;
const PROFILES_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as ValidatorSchema;
// A page loaded before the update still holds the old shape, without the buffs that moved in: it is refused rather than
// migrated, so it can never write over them.
const OLD_PAGE = "profiles are saved in a newer shape now; reload the page and make the change again";

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, panelPrefsFile: PANEL_PREFS, profilesStore, savePanel, uiPrefsStore } = ctx;
  return [
    // The player's profiles, and the shard's built-in templates beside them (read-only, never written into the file).
    // `readOnly`: why the file cannot be saved (a newer Pack Rat made it), when it cannot; every PUT is then a 409.
    { method: "GET", path: "/api/profiles", handle: async (_req, res) => {
      const profiles = await profilesStore.read(), readOnly = profilesStore.readOnly();
      return send(res, 200, { ok: true, profiles, builtinTemplates: profilesStore.builtins(), ...(readOnly ? { readOnly } : {}) });
    } },
    { method: "PUT", path: "/api/profiles", handle: async (req, res) => {
      const body = await readBody(req, { limit: 1e6, tooLargeMsg: "profiles too large" });
      const readOnly = profilesStore.readOnly();
      if (readOnly) return send(res, 409, { ok: false, error: readOnly });
      const version = (body as { schemaVersion?: unknown } | null)?.schemaVersion;
      if (typeof version === "number" && version < PROFILES_VERSION) return send(res, 400, { ok: false, error: OLD_PAGE });
      const { ok, errors } = validate(PROFILES_SCHEMA, body);
      if (!ok) return send(res, 400, { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}`, errors });
      const bad = profilesSpecError(body as ProfilesV3);
      if (bad) return send(res, 400, { ok: false, error: bad });
      profilesStore.write(body as ProfilesV3);
      return send(res, 200, { ok: true });
    } },
    { method: "GET", path: "/api/ui-prefs", handle: (_req, res) => {
      const { autoBuffs: _on, buffSkills: _skills, ...prefs } = uiPrefsStore.read();   // moved to profiles.json, waiting for its migration
      return send(res, 200, { ok: true, prefs });
    } },
    { method: "PUT", path: "/api/ui-prefs", handle: async (req, res) => {
      // The page's own view choices (the Inventory tab's columns, the look, the sidebar). Kept here rather than in
      // the page's localStorage because the desktop app serves the page from a new port, and so a new
      // origin, on every launch. Only known fields, each checked, are written.
      const body = asObject(await readBody(req, { limit: 16e3 }));
      const next = uiPrefsStore.read();
      for (const key of UI_PREF_LISTS) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        const v = body[key];
        if (!Array.isArray(v) || v.length > 200 || !v.every((c) => isBoundedString(c, 64))) return send(res, 400, { ok: false, error: `${key} must be a list of at most 200 keys` });
        next[key] = v as string[];
      }
      for (const [key, allowed] of Object.entries(UI_PREF_CHOICES)) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        const v = body[key];
        if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) return send(res, 400, { ok: false, error: `${key} must be one of ${allowed.join(", ")}` });
        next[key as keyof typeof UI_PREF_CHOICES] = v;
      }
      if (Object.prototype.hasOwnProperty.call(body, "colWidths")) {
        if (!isColWidths(body.colWidths)) return send(res, 400, { ok: false, error: "colWidths must map at most 200 column keys to whole widths from 40 to 1200 px" });
        next.colWidths = body.colWidths;
      }
      if (Object.prototype.hasOwnProperty.call(body, "mapDrawerWidth")) {
        if (!isDrawerWidth(body.mapDrawerWidth)) return send(res, 400, { ok: false, error: "mapDrawerWidth must be a whole width from 320 to 4000 px" });
        next.mapDrawerWidth = body.mapDrawerWidth;
      }
      if (Object.prototype.hasOwnProperty.call(body, "manualSuit")) {
        if (!isManualSuit(body.manualSuit)) return send(res, 400, { ok: false, error: "manualSuit must map the suit's slots to item serials" });
        next.manualSuit = body.manualSuit;
      }
      // Manual's buffs (app/buffs.mts): catalog ids, and the numbers they scale with, each within its bounds.
      if (Object.prototype.hasOwnProperty.call(body, "manualBuffs")) {
        if (!isBuffList(body.manualBuffs)) return send(res, 400, { ok: false, error: "manualBuffs must list known buffs, each once, one form at most" });
        next.manualBuffs = body.manualBuffs;
      }
      if (Object.prototype.hasOwnProperty.call(body, "manualBuffSkills")) {
        if (!isBuffSkills(body.manualBuffSkills)) return send(res, 400, { ok: false, error: "manualBuffSkills must map known buff skills to numbers within their ranges" });
        next.manualBuffSkills = body.manualBuffSkills;
      }
      // Automatic's buffs and the numbers edited for a character are the character's profile now (PUT /api/profiles).
      for (const key of ["autoBuffs", "buffSkills"]) if (Object.prototype.hasOwnProperty.call(body, key)) return send(res, 400, { ok: false, error: `${key} is kept with the profiles now; reload the page` });
      for (const key of UI_PREF_VERSIONS) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        if (!isBoundedString(body[key], 64)) return send(res, 400, { ok: false, error: `${key} must be a version of at most 64 characters` });
        next[key] = body[key];
      }
      uiPrefsStore.write(next);
      return send(res, 200, { ok: true });
    } },
    { method: "GET", path: "/api/tazuo-panel", handle: (_req, res) => {
      return send(res, 200, { ok: true, prefs: readPanelPrefs(PANEL_PREFS) });
    } },
    { method: "PUT", path: "/api/tazuo-panel", handle: async (req, res) => {
      const body = asObject(await readBody(req, { limit: 8e3 }));
      const bad = panelPrefsError(body);
      if (bad) return send(res, 400, { ok: false, error: bad });
      if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
      savePanel(body);
      return send(res, 200, { ok: true, prefs: readPanelPrefs(PANEL_PREFS) });
    } },
  ];
}
