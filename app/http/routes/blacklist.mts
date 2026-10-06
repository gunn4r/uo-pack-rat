// blacklist.mts — GET|POST /api/blacklist and DELETE /api/blacklist/<serial>.
import { isBoundedInt, MAX_SERIAL } from "../../guards.mts";
import { readBody } from "../../read-body.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { blacklistStore } = ctx;
  return [
    { method: "GET", path: "/api/blacklist", handle: (_req, res) => send(res, 200, { ok: true, containers: blacklistStore.read() }) },
    { method: "POST", path: "/api/blacklist", handle: async (req, res) => {
      const { serial, name, where } = asObject(await readBody(req, { limit: 8e3 }));
      if (!isBoundedInt(serial, 1, MAX_SERIAL)) return send(res, 400, { ok: false, error: "serial required (positive integer)" });
      if (typeof name !== "string" || (where !== undefined && typeof where !== "string")) return send(res, 400, { ok: false, error: "name and where must be strings" });
      const entries = blacklistStore.read();
      if (entries.some((e) => e.serial === serial)) return send(res, 200, { ok: true });
      if (entries.length >= 1000) return send(res, 409, { ok: false, error: "the blacklist is full (1000 containers)" });
      const place = where?.slice(0, 64).trim();
      entries.push({ serial, name: name.slice(0, 64).trim() || "container", addedAt: new Date().toISOString(), ...(place ? { where: place } : {}) });
      blacklistStore.write(entries);
      return send(res, 200, { ok: true });
    } },
    { method: "DELETE", path: /^\/api\/blacklist\/(\d{1,10})$/, handle: (_req, res, _url, unlist) => {
      blacklistStore.write(blacklistStore.read().filter((e) => e.serial !== Number(unlist[1])));
      return send(res, 200, { ok: true });
    } },
  ];
}
