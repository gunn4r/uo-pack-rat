// inventory.mts — the inventory: GET /api/inventory, /api/missing, /api/items and /api/items/by-serial.
//
// The routes, what each takes and answers:
// - `GET /api/inventory` (the cached fold of every scan, with Organize's results overlay applied — getInventory(), keyed by a signature of the scans directory + shard, and of organize-state.json for the overlay, so an edited/added/removed scan file or a finished trip is picked up on the next request with no restart; each scan file is upgraded v1→v2 and schema- validated on read — scanStore.all() — an invalid or unparsable file is logged and skipped) — the response carries facets/worn/rootCounts/missingCounts/itemCount/propKeys — never the full item map (that stopped shipping in Task 5, once the page moved to paging GET /api/items instead)
// - `GET /api/missing?root=` — what left that root since its last scan (app/missing.mts, issue #99)
// - `GET /api/items?q=&slot=&loc=&rarity=&kind=&seenDays=&slayer=&nogarg=&med=&hide=&prop=&group=&sort=&dir=&offset=&limit=` — a paged, server-side search/sort over the same folded inventory (parseItemQuery/applyItemQuery, app/item-query.mts); &fields=hits answers lean rows (hitRow), up to HIT_LIMIT a page, for the House map's search; &unravel=1 keeps only unravel candidates, each row with `unravel: {ingredient, weight, maybe, leftOut?}` (app/unravel.mts, issue #271), less the pieces left out by default (worn, in a saved run, insured, pinned in Organize, imbued, blessed, kept) unless &unravelShow= names those reasons (or `all`); sort=unravel is by weight
// - `GET /api/items/by-serial?serials=1,2,3` — full item records (location/tags/equippedBy…) by serial, 1-200 at a time (400 otherwise); a serial with no item is simply absent from the response
//
// map: server
// owns: `routes`
import { parseItemQuery, applyItemQuery, facetsOf, wantsHits, hitRow, type ItemQueryRows, type ItemQueryGroups, type UnravelContext } from "../../item-query.mts";
import { labelledPlaces, type Item } from "../../vault-lib.mts";
import { leftOutReasons } from "../../unravel.mts";
import { suitPieces } from "../../runs-lib.mts";
import { unravelKeep } from "../../store/settings.mts";
import { send } from "../respond.mts";
import type { Route } from "../router.mts";
import type { InventoryApiResponse, ItemHitsApiResponse, ItemsApiResponse, ItemsBySerialApiResponse, MissingApiResponse } from "../../api/inventory.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, appSettings, getInventory, organizeService, runStore, organizeStore } = ctx;
  // An unravel query's context (issue #271): the pieces of every saved run's suit, Organize's pinned items and the Keep list.
  function unravelContext(): UnravelContext {
    const left = { suits: suitPieces(runStore.all()), pins: new Set(organizeStore.read().config.pinnedItems), kept: new Set(unravelKeep(appSettings.current())) };
    return { rules: appSettings.rules(), leftOut: (it) => leftOutReasons(it, left) };
  }
  return [
    { method: "GET", path: "/api/inventory", handle: async (_req, res) => {
      const { inv, missing, snapshotCount } = await getInventory();
      const itemsArr = Object.values(inv.items);
      const worn: Record<string, Item[]> = {}, rootCounts: Record<string, number> = {};
      for (const it of itemsArr) {
        if (it.equippedBy) (worn[it.equippedBy] ||= []).push(it);
        if (it.root != null) rootCounts[it.root] = (rootCounts[it.root] || 0) + 1;
      }
      const facets = facetsOf(itemsArr, { rarity: appSettings.rules().rarity });
      // A blacklisted container is never opened again, so its last two scans are stale: it reports nothing.
      const listed = organizeService.blacklisted();
      const missingCounts = Object.fromEntries(Object.entries(missing).filter(([root]) => !listed.has(+root)).map(([root, list]) => [root, list.length]));
      const inventory = { scans: inv.scans, characters: inv.characters, containers: inv.containers, worn, rootCounts, missingCounts, itemCount: itemsArr.length, facets, propKeys: facets.propKeys };
      return send(res, 200, { ok: true, snapshotCount, demo: CONFIG.demo, inventory } satisfies InventoryApiResponse);
    } },
    // GET /api/missing?root=<serial> — the items missing from that root since its last scan (app/missing.mts,
    // issue #99); /api/inventory carries only the counts. A root with nothing missing, or blacklisted, answers an empty list.
    { method: "GET", path: "/api/missing", handle: async (_req, res, url) => {
      const root = url.searchParams.get("root") || "";
      if (!/^\d{1,10}$/.test(root)) return send(res, 400, { ok: false, error: "root must be a container serial" });
      const { missing } = await getInventory();
      const listed = organizeService.blacklisted().has(+root);
      return send(res, 200, { ok: true, items: (!listed && missing[String(+root)]) || [] } satisfies MissingApiResponse);
    } },
    { method: "GET", path: "/api/items", handle: async (_req, res, url) => {
      const { inv } = await getInventory();
      const query = parseItemQuery(url.searchParams);
      const result = applyItemQuery(Object.values(inv.items), query, { rarity: appSettings.rules().rarity, places: labelledPlaces(inv.containers, organizeStore.read().config.labels), ...(query.unravel ? { unravel: unravelContext() } : {}) });
      if (wantsHits(url.searchParams)) return send(res, 200, { ok: true, total: result.total, offset: query.offset, limit: query.limit, rows: (result as ItemQueryRows).rows.map(hitRow) } satisfies ItemHitsApiResponse);
      // applyItemQuery returns the ItemQueryRows | ItemQueryGroups union; narrow at each call site
      // by query.group, same as app/item-query.test.mts does — `total` is common to both branches.
      if (query.group) { const g = result as ItemQueryGroups; return send(res, 200, { ok: true, total: g.total, stacks: g.stacks, pieces: g.pieces, offset: query.offset, limit: query.limit, groups: g.groups } satisfies ItemsApiResponse); }
      return send(res, 200, { ok: true, total: result.total, pieces: (result as ItemQueryRows).pieces, offset: query.offset, limit: query.limit, rows: (result as ItemQueryRows).rows } satisfies ItemsApiResponse);
    } },
    // GET /api/items/by-serial?serials=1,2,3 — the one place the page can still ask for a FULL item
    // record (location, tags, equippedBy…) by serial, now that GET /api/inventory never carries the
    // whole item map: the suit builder's result panel and the hover tooltip both need to enrich a bare
    // serial (from a paged /api/items row that scrolled off, or an optimizer pool item, which only ever
    // carries {serial,name,slot,props}) on demand. Capped at 200 serials per call; a serial with no
    // matching item is simply absent from the response rather than an error.
    { method: "GET", path: "/api/items/by-serial", handle: async (_req, res, url) => {
      const raw = (url.searchParams.get("serials") || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!raw.length || raw.length > 200 || raw.some((s) => !/^\d+$/.test(s))) {
        return send(res, 400, { ok: false, error: "serials must be 1-200 comma-separated non-negative integers" });
      }
      const { inv } = await getInventory();
      const items: Record<string, Item> = {};
      for (const s of raw) { const it = inv.items[s]; if (it) items[s] = it; }
      return send(res, 200, { ok: true, items } satisfies ItemsBySerialApiResponse);
    } },
  ];
}
