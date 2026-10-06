// kinds.mts — the player's item kinds: GET|POST /api/item-kinds and POST /api/item-kinds/import.
import { isBoundedInt } from "../../guards.mts";
import { isKindName, kindCount, kindsDocument, kindsFor, salvageKindOverrides, withKinds, withoutKinds, KIND_LIMITS, MAX_KINDS_BYTES, OVERRIDE_KINDS } from "../../item-kinds.mts";
import { readBody } from "../../read-body.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { eventBus, itemKindsStore } = ctx;
  return [
    // The player's item kinds (issue #150): GET the whole document (the page's Classify this… and Export read it);
    // POST {name?, graphic?, kind} sets the kind for an exact item name and/or a graphic, and kind null takes those
    // entries away (Reset to automatic); POST /api/item-kinds/import {names?, graphics?} merges a file in, its
    // entries winning, and says what it left out. Every change re-kinds the inventory with no rescan (getInventory).
    { method: "GET", path: "/api/item-kinds", handle: (_req, res) => send(res, 200, { ok: true, ...kindsDocument(itemKindsStore.read()) }) },
    { method: "POST", path: "/api/item-kinds", handle: async (req, res) => {
      const { name, graphic, kind } = asObject(await readBody(req, { limit: 8e3 }));
      if (name !== undefined && !(typeof name === "string" && isKindName(name))) return send(res, 400, { ok: false, error: `name must be an item name of at most ${KIND_LIMITS.name} characters` });
      if (graphic !== undefined && !isBoundedInt(graphic, 0, 0xFFFF)) return send(res, 400, { ok: false, error: "graphic must be an item graphic (0 to 65535)" });
      if (name === undefined && graphic === undefined) return send(res, 400, { ok: false, error: "name or graphic is required" });
      if (kind !== null && !OVERRIDE_KINDS.includes(kind as string)) return send(res, 400, { ok: false, error: `kind must be null or one of ${OVERRIDE_KINDS.join(", ")}` });
      const base = itemKindsStore.read(), at = { name: name as string | undefined, graphic: graphic as number | undefined };
      const next = kind === null ? withoutKinds(base, at) : withKinds(base, kindsFor(at, kind as string));
      const refused = itemKindsStore.save(next);
      if (refused) return send(res, 409, { ok: false, error: refused });
      eventBus.broadcast("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
      return send(res, 200, { ok: true, ...kindsDocument(next!) });
    } },
    { method: "POST", path: "/api/item-kinds/import", handle: async (req, res) => {
      const body = asObject(await readBody(req, { limit: MAX_KINDS_BYTES, tooLargeMsg: "the item kinds file is too large" }));
      const { overrides, problems } = salvageKindOverrides(body);
      if (!kindCount(overrides)) return send(res, 400, { ok: false, error: `the file holds no item kinds to import${problems.length ? ` (${problems[0]})` : ""}` });
      const next = withKinds(itemKindsStore.read(), overrides);
      const refused = itemKindsStore.save(next);
      if (refused) return send(res, 409, { ok: false, error: `the import was refused: ${refused}` });
      eventBus.broadcast("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
      return send(res, 200, { ok: true, ...kindsDocument(next!), skipped: problems.length, problems: problems.slice(0, 5) });
    } },
  ];
}
