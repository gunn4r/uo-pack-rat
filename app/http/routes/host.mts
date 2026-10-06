// host.mts — what only the desktop shell can do (POST /api/host/pick-folder and /api/host/open-path) and the shared event stream (GET /api/events).
import { isBoundedString } from "../../guards.mts";
import { readBody, type HttpError } from "../../read-body.mts";
import { sse } from "../../services/events.mts";
import { send, asObject, SSE_HEADERS } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { eventBus, host, timers, watchers } = ctx;
  // A folder dialog whose answer never comes back would otherwise hang this request for ever:
  // server.requestTimeout governs request RECEIPT only and never touches a response that has not
  // started. Bound it here and answer 504 instead of holding the socket open. The embedder bounds its
  // own half of the same call with the same 60 s (electron/pending-calls.mts, whose expiry rejects
  // with this very statusCode), so whichever side notices first the caller sees one answer — this is
  // not a second chance for a call the shell already gave up on (area-4 minor 5).
  const HOST_CALL_TIMEOUT_MS = 60 * 1000;
  function withHostTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        const e = new Error("the desktop app did not answer") as HttpError;
        e.statusCode = 504;
        reject(e);
      }, HOST_CALL_TIMEOUT_MS);
      t.unref(); timers.add(t);
      const done = (): void => { clearTimeout(t); timers.delete(t); };
      p.then((v) => { done(); resolve(v); }, (e: unknown) => { done(); reject(e as Error); });
    });
  }
  return [
    { method: "POST", path: "/api/host/pick-folder", handle: async (req, res) => {
      if (!host || typeof host.pickFolder !== "function") return send(res, 501, { ok: false, error: "not available outside the desktop app" });
      const { title } = asObject(await readBody(req, { limit: 8e3 }));
      // A dialog title is a short display string or nothing at all. Anything else — a non-string, or
      // a megabyte of text the 50 MB default body cap used to wave through — falls back to the
      // shell's own default rather than crossing two process hops into a native, app-modal dialog
      // the user is being asked to trust (post-review fix, area-4 minor 1).
      const path = await withHostTimeout(host.pickFolder(isBoundedString(title, 120) ? { title } : {}));
      return send(res, 200, { ok: true, path });
    } },
    { method: "POST", path: "/api/host/open-path", handle: async (req, res) => {
      if (!host || typeof host.openPath !== "function") return send(res, 501, { ok: false, error: "not available outside the desktop app" });
      const { which } = asObject(await readBody(req, { limit: 8e3 }));
      if (which !== "data" && which !== "logs") return send(res, 400, { ok: false, error: 'which must be "data" or "logs"' });
      // The DISCRIMINATOR crosses the wire, not a resolved path (phase-7 security review, area-4
      // Important 1): the shell owns the two directories it maps "data"/"logs" to, so this process —
      // the lower-trust half of the split — cannot name a third thing for the OS to launch.
      await withHostTimeout(host.openPath(which));
      return send(res, 200, { ok: true });
    } },
    { method: "GET", path: "/api/events", handle: (_req, res) => {
      res.writeHead(200, SSE_HEADERS);
      sse(res, "hello", { ok: true, watching: Array.from(watchers.keys()) });
      eventBus.add(res);
      const ping = setInterval(() => sse(res, "ping", { at: Date.now() }), 15000);
      ping.unref(); timers.add(ping);
      res.on("close", () => { clearInterval(ping); timers.delete(ping); eventBus.remove(res); });
      return;
    } },
  ];
}
