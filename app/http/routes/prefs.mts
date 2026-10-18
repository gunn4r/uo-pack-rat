// prefs.mts — the player's saved choices: GET|PATCH /api/profiles, /api/ui-prefs and /api/tazuo-panel.
//
// The routes, what each takes and answers:
// - `GET /api/profiles` (`<data>/profiles.json`; also answers `builtinTemplates`, the shard's built-in templates from `app/data/templates/<shard>.json`, and the file's content `stamp`, which a PATCH's `was` is compared with)
// - `PATCH /api/profiles` (`{edits}`, quality pass 1: 1 to 100 `app/profile-edits.mts` edits made in order on the file as it is on the server and written once, with nothing awaited between the read and the write, so a page's save carries what it means and no other saved setting rides along. The ops: `setBuffs`, `setLabel` (issue #336's build label: trimmed, a blank one removed, at most 40 characters on one line, `labelError`; a scanned or saved character only, never a pseudo one), `saveCharacter`, `deleteCharacter`, `putTemplate`, `updateTemplate`, `deleteTemplate`, `renameTemplate` (its characters follow). A bad edit is 400 naming why; one that can't be made on the file now (a template deleted elsewhere, a name taken, no such character) is 409 `conflict`, and the list writes nothing; the result goes through the same schema and spec checks as a whole-file save. Answers the stamp before (`was`) and after the write. It writes only over the file it read: when another save landed in between, it makes the edits again on the newer file, at most three times, then answers 409 `stale`. `__proto__`, `constructor` and `prototype` are refused as names. It replaces `PUT /api/profiles/label`.)
// - `GET|PUT /api/tazuo-panel` ({hotkey?, showAtLogin?} -> {prefs}: the TazUO panel's hotkey and whether it shows its window at login, `<data>/tazuo-panel.json`, app/tazuo-panel.mts)
// - `GET|PUT /api/ui-prefs` (`<data>/ui-prefs.json:` {cols?, colsVersion?, colWidths?, sheetProps?, theme?, appearance?, sidebar?, density?, areaLabels?, mapDrawerWidth?, builderMode?, builderTab?, builderChanges?, builderFineTune?, manualFor?, manualSuit?, manualBuffs?, manualBuffSkills?, buffsCount?, dismissedUpdate?, copiedScanner?}, the page's view choices; `autoBuffs` and `buffSkills` are refused, since a character's buffs are its profile's now)
//
// map: server
// owns: `routes`, `patchProfiles`
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBuffList, isBuffSkills } from "../../buffs.mts";
import { profilesSpecError } from "../../build-spec.mts";
import { applyProfileEdits, profileEditError, type ProfileEdit } from "../../profile-edits.mts";
import { isPseudoCharacter } from "../../scan-schema.mts";
import { isBoundedString } from "../../guards.mts";
import { readBody } from "../../read-body.mts";
import { validate, type ValidatorSchema } from "../../schema/validate.mts";
import { isColWidths, isDrawerWidth, isManualSuit, UI_PREF_CHOICES, UI_PREF_LISTS, UI_PREF_VERSIONS } from "../../store/ui-prefs.mts";
import { panelPrefsError } from "../../tazuo-panel.mts";
import { send, asObject } from "../respond.mts";
import { APP_DIR } from "../../config.mts";
import type { Route } from "../router.mts";
import type { OkApiResponse } from "../../api/routes.mts";
import type { ProfilesApiResponse, ProfilesPatchApiResponse, TazuoPanelApiResponse, UiPrefsApiResponse } from "../../api/prefs.mts";
import type { ServerContext } from "../context.mts";

const HERE = APP_DIR;
const PROFILES_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as ValidatorSchema;
// The most edits one PATCH /api/profiles makes (a page sends one or two).
const MAX_EDITS = 100;

// PATCH /api/profiles' edits made on the file as read and written only over that same file (the store's `base`). A
// save that landed in between (two first reads can share one v2 migration, and so one copy) is never written over: the
// edits are made again on the file it left, at most three times, then refused as stale. `scanned`: the characters a
// label may go on besides the saved ones.
export async function patchProfiles(store: ServerContext["profilesStore"], list: ProfileEdit[], scanned: string[]): Promise<{ status: number; body: Record<string, unknown> }> {
  for (let i = 0; i < 3; i++) {
    const { profiles: stored, stamp: was } = await store.readStamped(), next = structuredClone(stored);
    const canLabel = (name: string): boolean => !isPseudoCharacter(name) && (Object.hasOwn(stored.characters, name) || scanned.includes(name));
    const refused = applyProfileEdits(next, list, { builtins: store.builtins(), canLabel });
    if (refused) return { status: 409, body: { ok: false, code: "conflict", error: refused } };
    const { ok, errors } = validate(PROFILES_SCHEMA, next);
    if (!ok) return { status: 400, body: { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}`, errors } };
    const bad = profilesSpecError(next, stored);
    if (bad) return { status: 400, body: { ok: false, error: bad } };
    const saved = store.write(next, was);
    if (saved.ok) return { status: 200, body: { ok: true, stamp: saved.stamp, was } satisfies ProfilesPatchApiResponse };
  }
  return { status: 409, body: { ok: false, code: "stale", error: "the profiles kept changing while this save was made; reload them and make the change again" } };
}

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, panelPrefsStore, profilesStore, uiPrefsStore, getInventory } = ctx;
  return [
    // The player's profiles, and the shard's built-in templates beside them (read-only, never written into the file).
    // `readOnly`: why the file cannot be saved (a newer Pack Rat made it), when it cannot; every PATCH is then a 409.
    // `stamp`: the file's content stamp, which a PATCH's `was` is compared with.
    { method: "GET", path: "/api/profiles", handle: async (_req, res) => {
      const { profiles, stamp } = await profilesStore.readStamped(), readOnly = profilesStore.readOnly();
      return send(res, 200, { ok: true, profiles, stamp, builtinTemplates: profilesStore.builtins(), ...(readOnly ? { readOnly } : {}) } satisfies ProfilesApiResponse);
    } },
    // The one way to save the profiles: edits (app/profile-edits.mts), {edits: [...]}, 1 to 100, made in order on the file as it is on the
    // server and written once, so a page's save carries what it means and never its copy of the rest. Each edit's shape is
    // checked first (400), then one that can't be made on the file now (a template deleted elsewhere, a name taken, a
    // label for no such character) refuses the whole list (409 "conflict"), and the result is held to the profiles
    // schema and profilesSpecError (400; a template name already stored passes as it is). Answers the file's stamp before (`was`) and after the write, so a page
    // whose copy was the file before knows its copy plus the edits is the file now, and one holding another reloads.
    { method: "PATCH", path: "/api/profiles", handle: async (req, res) => {
      const { edits } = asObject(await readBody(req, { limit: 1e6, tooLargeMsg: "profiles too large" }));
      const readOnly = profilesStore.readOnly();
      if (readOnly) return send(res, 409, { ok: false, error: readOnly });
      if (!Array.isArray(edits) || !edits.length || edits.length > MAX_EDITS) return send(res, 400, { ok: false, error: `edits must be a list of 1 to ${MAX_EDITS} edits` });
      for (const e of edits) { const bad = profileEditError(e); if (bad) return send(res, 400, { ok: false, error: bad }); }
      const list = edits as ProfileEdit[];
      const inv = list.some((e) => e.op === "setLabel") ? (await getInventory()).inv : null;
      const r = await patchProfiles(profilesStore, list, inv ? Object.keys(inv.characters) : []);
      return send(res, r.status, r.body);
    } },
    { method: "GET", path: "/api/ui-prefs", handle: (_req, res) => {
      const { autoBuffs: _on, buffSkills: _skills, ...prefs } = uiPrefsStore.read();   // moved to profiles.json, waiting for its migration
      return send(res, 200, { ok: true, prefs } satisfies UiPrefsApiResponse);
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
        (next as Record<string, unknown>)[key] = v;   // one of its allowed values, just checked
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
      // Automatic's buffs and the numbers edited for a character are the character's profile now (a setBuffs edit, PATCH /api/profiles).
      for (const key of ["autoBuffs", "buffSkills"]) if (Object.prototype.hasOwnProperty.call(body, key)) return send(res, 400, { ok: false, error: `${key} is kept with the profiles now; reload the page` });
      for (const key of UI_PREF_VERSIONS) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        if (!isBoundedString(body[key], 64)) return send(res, 400, { ok: false, error: `${key} must be a version of at most 64 characters` });
        next[key] = body[key];
      }
      uiPrefsStore.write(next);
      return send(res, 200, { ok: true } satisfies OkApiResponse);
    } },
    { method: "GET", path: "/api/tazuo-panel", handle: (_req, res) => {
      return send(res, 200, { ok: true, prefs: panelPrefsStore.read() } satisfies TazuoPanelApiResponse);
    } },
    { method: "PUT", path: "/api/tazuo-panel", handle: async (req, res) => {
      const body = asObject(await readBody(req, { limit: 8e3 }));
      const bad = panelPrefsError(body);
      if (bad) return send(res, 400, { ok: false, error: bad });
      if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
      panelPrefsStore.save(body);
      return send(res, 200, { ok: true, prefs: panelPrefsStore.read() } satisfies TazuoPanelApiResponse);
    } },
  ];
}
