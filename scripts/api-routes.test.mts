// api-routes.test.mts — a [smoke] guard that `app/api/routes.mts`'s route map and the routes `app/http/routes/` registers agree, both ways (issue #338).
//
// Every /api route a route module registers (`{ method, path }`, a string or a RegExp literal) must answer at least one
// map entry, and every entry ("METHOD /path", each <name> standing for one path segment) must be answered by a route of
// its method (or "*"). Read from the sources, as the module map's route check is: the route table needs a server to build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

interface Registered { file: string; method: string; path: string | RegExp }
// A registered route's `path`: a string, or a RegExp literal (its body up to the closing slash outside any escape or
// character class, then its flags).
const ROUTE = /\{\s*method:\s*"([A-Z]+|\*)",\s*path:\s*(?:"([^"]+)"|\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([a-z]*))\s*,/g;
export function registered(file: string, text: string): Registered[] {
  return [...text.matchAll(ROUTE)].map((m) => ({ file, method: m[1]!, path: m[2] ?? new RegExp(m[3]!, m[4]) }));
}
// The map's keys, as written in the ApiRoutes interface.
export function mapKeys(text: string): Array<{ method: string; path: string }> {
  const body = text.slice(text.indexOf("export interface ApiRoutes {"));
  return [...body.slice(0, body.indexOf("\n}\n")).matchAll(/^\s+"([A-Z]+) (\/[^"]+)":/gm)].map((m) => ({ method: m[1]!, path: m[2]! }));
}
// A concrete path for a key: each <name> becomes one segment's worth of digits.
const sample = (path: string): string => path.replace(/<[^>]+>/g, "123");
const serves = (r: Registered, method: string, path: string): boolean =>
  (r.method === "*" || r.method === method) && (typeof r.path === "string" ? r.path === path : r.path.test(path));
const isApi = (r: Registered): boolean => (typeof r.path === "string" ? r.path.startsWith("/api/") : r.path.source.startsWith("^\\/api\\/"));

test("[smoke] api routes: the parsers read string and RegExp paths and the map's keys", () => {
  assert.deepEqual(registered("x.mts", `{ method: "GET", path: "/api/a", handle }\n{ method: "*", path: /^\\/api\\/runs\\/([\\w-]+)$/, handle }\n{ method: "DELETE", path: /^\\/api\\/c\\/[^/]+$/i, handle }`).map((r) => [r.method, String(r.path)]),
    [["GET", "/api/a"], ["*", "/^\\/api\\/runs\\/([\\w-]+)$/"], ["DELETE", "/^\\/api\\/c\\/[^/]+$/i"]]);
  assert.deepEqual(mapKeys(`export interface ApiRoutes {\n  // a\n  "GET /api/a/<id>": Untyped;\n}\n`), [{ method: "GET", path: "/api/a/<id>" }]);
  assert.equal(sample("/api/optimize/<id>/events"), "/api/optimize/123/events");
});

test("[smoke] api routes: every /api route has a map entry and every entry a route", () => {
  const dir = join(root, "app/http/routes");
  const routes = readdirSync(dir).filter((f) => f.endsWith(".mts") && !f.endsWith(".test.mts"))
    .flatMap((f) => registered(f, readFileSync(join(dir, f), "utf8"))).filter(isApi);
  const keys = mapKeys(readFileSync(join(root, "app/api/routes.mts"), "utf8"));
  assert.ok(routes.length >= 50 && keys.length >= 50, `read ${routes.length} routes and ${keys.length} map entries`);
  const unserved = keys.filter((k) => !routes.some((r) => serves(r, k.method, sample(k.path)))).map((k) => `${k.method} ${k.path}: no route in app/http/routes/ serves it`);
  const unmapped = routes.filter((r) => !keys.some((k) => serves(r, k.method, sample(k.path)))).map((r) => `${r.file}: ${r.method} ${String(r.path)} has no entry in app/api/routes.mts`);
  assert.deepEqual([...unserved, ...unmapped], []);
});
