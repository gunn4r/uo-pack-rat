// import.mts — POST /api/import/paste and /api/import/rescan.
import { short } from "../../guards.mts";
import { parsePastedScan, writeScanToInbox } from "../../import.mts";
import { safeAppendLog } from "../../log.mts";
import { readBody } from "../../read-body.mts";
import { MAX_INBOX_BYTES } from "../../watcher.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, setupService, watchers } = ctx;
  return [
    { method: "POST", path: "/api/import/paste", handle: async (req, res) => {
      // Capped at the watcher's own inbox limit: a bigger paste would be written, answered 200, and
      // then rejected by the watcher, so it is refused here instead.
      const { text, adapter } = asObject(await readBody(req, { limit: MAX_INBOX_BYTES, tooLargeMsg: "paste too large" }));
      // Same allowlist as every other adapter-taking route — adapter reaches
      // CONFIG.paths.inboxFor -> path.join, so it must be a real, known id before that.
      if (!setupService.adapters().some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
      const parsed = parsePastedScan(text);
      if (!parsed.ok) return send(res, 400, { ok: false, error: parsed.error });
      // Post-review minor: `adapter` (which inbox the file gets filed under, from the Import tab's
      // picker) and `parsed.doc.adapter.id` (what the pasted document itself says it came from) can
      // disagree — a player who picks the wrong adapter in the dropdown before pasting, most likely
      // when only one client is configured and the picker is hidden (see ui/import.mts's
      // adapterPicker) so the mismatch has no visible cause. Harmless to the fold itself (nothing
      // downstream trusts which inbox a scan sat in over the document's own adapter block), but
      // worth surfacing rather than filing it silently — logged here, and returned as `warning` so
      // the Import tab can show it too.
      // The declared id is the pasted DOCUMENT's own field, so it is caller-controlled text: bounded
      // and JSON.stringify'd before it reaches a log line (post-review fix, Minor 10). A JSON string
      // escape (\n) survives parsePastedScan's literal-newline strip and parses into a real newline,
      // so raw interpolation let a caller forge as many correctly-timestamped log lines as it liked —
      // in the one file the 500-handler's `ref` scheme is built around.
      const declaredAdapter = parsed.doc?.adapter?.id ? short(parsed.doc.adapter.id) : undefined;
      const mismatch = declaredAdapter && declaredAdapter !== adapter;
      if (mismatch) {
        safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} import-paste warn: pasted into ${JSON.stringify(adapter)}'s inbox but the document declares adapter ${JSON.stringify(declaredAdapter)}\n`);
      }
      const { file, character } = writeScanToInbox({ doc: parsed.doc, adapter: adapter as string, paths: CONFIG.paths });
      // Nudge the watcher: there is no reason to make the player wait on fs.watch's debounce when the
      // file is already on disk.
      watchers.get(adapter as string)?.scanOnce();
      return send(res, 200, { ok: true, written: file, character,
        ...(mismatch ? { warning: `filed under "${adapter}", but this scan says it's from "${declaredAdapter}" — check the Adapter picker above` } : {}) });
    } },
    { method: "POST", path: "/api/import/rescan", handle: async (req, res) => {
      asObject(await readBody(req, { limit: 8e3 }));   // {} — no fields read, but every POST still needs a declared JSON object body (readBody's content-type check, asObject's shape check)
      // scanOnce() recreates a deleted inbox and re-arms its watch; false means it could not sweep
      // at all (the reason is in the log), and that is reported rather than answered with ok: true.
      const adapters: string[] = [], failed: string[] = [];
      for (const [id, handle] of watchers) (handle.scanOnce() ? adapters : failed).push(id);
      if (failed.length) return send(res, 503, { ok: false, error: `could not sweep the inbox for ${failed.join(", ")} — see the log`, adapters, failed });
      return send(res, 200, { ok: true, adapters });
    } },
  ];
}
