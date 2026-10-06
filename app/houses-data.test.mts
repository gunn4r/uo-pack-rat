// houses-data.test.mts — `app/ui/houses-data.mts`, the House map's cache of house models by id and capture stamp (issue #10).
//
// `housesData()` with a stubbed fetch: the first load fetches the list, the names and every model; a second load for the same inventory fetches only the list and the names and hands back the same model objects, named as the list names them now; a house captured again (a newer capturedAt or another capture) is fetched again alone; a new inventory object or other tiledata fetches every model again; a house gone from the list is dropped; and a save is a PUT of the whole entry to that house. All `[fast]`.
import test from "node:test";
import assert from "node:assert/strict";
import { housesData } from "./ui/houses-data.mts";
import type { ApiOptions } from "./ui/api.mts";
import type { HouseSummary, HousesApiResponse } from "./ui/api-types.mts";

const summary = (id: string, capturedAt = "2026-01-01T00:00:00Z", captures = 1, name?: string): HouseSummary =>
  ({ id, ...(name ? { name } : {}), facet: 1, capturedAt, captures, width: 8, height: 8, plot: { x0: 0, y0: 0, x1: 7, y1: 7 }, levels: 1, containers: 0, serials: [] });

// A server holding `houses` (and the tiledata reason), recording every path asked for.
function server(houses: HouseSummary[], reason: string | null = null) {
  const calls: { path: string; opts?: ApiOptions | undefined }[] = [];
  const srv = {
    houses, reason, calls,
    get: async <T,>(path: string, opts?: ApiOptions): Promise<T> => {
      calls.push({ path, opts });
      if (path === "/api/houses") return { ok: true, tiledata: srv.reason === null, tiledataFrom: { folder: null, source: null, reason: srv.reason }, houses: srv.houses.map((h) => ({ ...h })) } as HousesApiResponse as T;
      if (path === "/api/house-map") return { ok: true, houses: {} } as T;
      if (opts?.method === "PUT") return { ok: true, entry: opts.body } as T;
      const id = decodeURIComponent(path.slice("/api/houses/".length)), h = srv.houses.find((x) => x.id === id)!;
      return { ok: true, house: { id, name: h.name, capturedAt: h.capturedAt, captures: h.captures } } as T;
    },
  };
  return srv;
}
const modelPaths = (s: ReturnType<typeof server>): string[] => s.calls.map((c) => c.path).filter((p) => p.startsWith("/api/houses/"));

test("[fast] houses-data: a second load for the same inventory fetches only the list and the names, and keeps the models", async () => {
  const s = server([summary("1-10-10"), summary("1-50-50")]), d = housesData(s.get), inv = {};
  const first = await d.load(inv);
  assert.deepEqual(modelPaths(s), ["/api/houses/1-10-10", "/api/houses/1-50-50"]);
  s.calls.length = 0;
  const second = await d.load(inv);
  assert.deepEqual(s.calls.map((c) => c.path).sort(), ["/api/house-map", "/api/houses"]);
  assert.equal(second.models[0], first.models[0]);
  assert.equal(second.models[1], first.models[1]);
});

test("[fast] houses-data: a kept model takes the name the list has now", async () => {
  const s = server([summary("1-10-10")]), d = housesData(s.get), inv = {};
  await d.load(inv);
  s.houses = [summary("1-10-10", undefined, undefined, "Tower")];
  assert.equal((await d.load(inv)).models[0]!.name, "Tower");
  s.houses = [summary("1-10-10")];
  assert.equal((await d.load(inv)).models[0]!.name, undefined);
  assert.deepEqual(modelPaths(s), ["/api/houses/1-10-10"]);
});

test("[fast] houses-data: a house captured again is fetched again, alone", async () => {
  const s = server([summary("1-10-10"), summary("1-50-50")]), d = housesData(s.get), inv = {};
  await d.load(inv);
  s.calls.length = 0;
  s.houses = [summary("1-10-10", "2026-02-01T00:00:00Z"), summary("1-50-50")];
  await d.load(inv);
  assert.deepEqual(modelPaths(s), ["/api/houses/1-10-10"]);
  s.calls.length = 0;
  s.houses = [summary("1-10-10", "2026-02-01T00:00:00Z"), summary("1-50-50", undefined, 2)];
  await d.load(inv);
  assert.deepEqual(modelPaths(s), ["/api/houses/1-50-50"]);
});

test("[fast] houses-data: a new inventory or other tiledata fetches every model again", async () => {
  const s = server([summary("1-10-10"), summary("1-50-50")]), d = housesData(s.get);
  const inv = {};
  await d.load(inv);
  s.calls.length = 0;
  await d.load({});
  assert.equal(modelPaths(s).length, 2);
  s.calls.length = 0;
  const now = {};
  await d.load(now);
  s.calls.length = 0;
  s.reason = "missing";
  await d.load(now);
  assert.equal(modelPaths(s).length, 2);
});

test("[fast] houses-data: a house gone from the list is dropped, and fetched again if it comes back", async () => {
  const s = server([summary("1-10-10"), summary("1-50-50")]), d = housesData(s.get), inv = {};
  await d.load(inv);
  s.houses = [summary("1-50-50")];
  assert.deepEqual((await d.load(inv)).models.map((m) => m.id), ["1-50-50"]);
  s.calls.length = 0;
  s.houses = [summary("1-10-10"), summary("1-50-50")];
  await d.load(inv);
  assert.deepEqual(modelPaths(s), ["/api/houses/1-10-10"]);
});

test("[fast] houses-data: a save is a PUT of the whole entry to that house", async () => {
  const s = server([]), d = housesData(s.get);
  const entry = { name: "Tower", areas: [] };
  const r = await d.saveEntry("1-10-10", entry);
  assert.deepEqual(s.calls, [{ path: "/api/house-map/1-10-10", opts: { method: "PUT", body: entry } }]);
  assert.deepEqual(r.entry, entry);
});
