// blacklist.mts — GET|POST /api/blacklist and DELETE /api/blacklist/<serial>.
//
// The routes, what each takes and answers:
// - `GET|POST {serial, name, where?} /api/blacklist`
// - `DELETE /api/blacklist/<serial>` (`<data>/scan-blacklist.json`, the containers scans never open)
//
// map: server
// owns: `routes`
import { isBoundedInt, MAX_SERIAL } from "../../guards.mts";
import { readBody } from "../../read-body.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { OkApiResponse } from "../../api/routes.mts";
import type { BlacklistApiResponse } from "../../api/inventory.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { blacklistStore } = ctx;
  return [
    { method: "GET", path: "/api/blacklist", handle: (_req, res) => send(res, 200, { ok: true, containers: blacklistStore.read() } satisfies BlacklistApiResponse) },
    { method: "POST", path: "/api/blacklist", handle: async (req, res) => {
      const { serial, name, where } = asObject(await readBody(req, { limit: 8e3 }));
      if (!isBoundedInt(serial, 1, MAX_SERIAL)) return send(res, 400, { ok: false, error: "serial required (positive integer)" });
      if (typeof name !== "string" || (where !== undefined && typeof where !== "string")) return send(res, 400, { ok: false, error: "name and where must be strings" });
      const place = where?.slice(0, 64).trim();
      let full = false;
      blacklistStore.update((entries) => {
        if (entries.some((e) => e.serial === serial)) return undefined;
        if (entries.length >= 1000) { full = true; return undefined; }
        return [...entries, { serial, name: name.slice(0, 64).trim() || "container", addedAt: new Date().toISOString(), ...(place ? { where: place } : {}) }];
      });
      if (full) return send(res, 409, { ok: false, error: "the blacklist is full (1000 containers)" });
      return send(res, 200, { ok: true } satisfies OkApiResponse);
    } },
    { method: "DELETE", path: /^\/api\/blacklist\/(\d{1,10})$/, handle: (_req, res, _url, unlist) => {
      blacklistStore.update((entries) => entries.filter((e) => e.serial !== Number(unlist[1])));
      return send(res, 200, { ok: true } satisfies OkApiResponse);
    } },
  ];
}
