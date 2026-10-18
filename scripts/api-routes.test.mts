// api-routes.test.mts — a [smoke] guard that `app/api/routes.mts`'s route map and the routes `app/http/routes/` registers agree, both ways (issue #338).
//
// Every /api route a route module registers (`{ method, path }`, a string or a RegExp literal anchored with `^`) must
// serve exactly one map entry ("METHOD /path", each <name> standing for one path segment), or exactly the entries
// FAN_OUT lists for it when one handler answers several methods or paths, and every entry must be served by a route.
// Read from the sources, as the module map's route check is: the route table needs a server to build. Every `method:`
// in a route module must be a route the parser read, so a route written another way fails here instead of dropping out.
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
// A concrete path for a key: each <name> becomes "123", which every parameter today accepts. A route whose RegExp wants
// another shape (a UUID, a house id) would report its own entry as served by no route: widen this then.
const sample = (path: string): string => path.replace(/<[^>]+>/g, "123");
const serves = (r: Registered, method: string, path: string): boolean =>
  (r.method === "*" || r.method === method) && (typeof r.path === "string" ? r.path === path : r.path.test(path));
const isApi = (r: Registered): boolean => (typeof r.path === "string" ? r.path.startsWith("/api/") : r.path.source.startsWith("^\\/api"));
// The routes whose one handler answers several entries, by the route's RegExp, with the entries it answers. Any other
// /api route serves exactly one entry.
const FAN_OUT: Record<string, string[]> = {
  [String(/^\/api\/houses(?:\/|$)/)]: ["GET /api/houses", "GET /api/houses/<id>"],
  [String(/^\/api\/runs\/([\w-]+)$/)]: ["GET /api/runs/<id>", "PUT /api/runs/<id>", "DELETE /api/runs/<id>"],
  [String(/^\/api\/optimize\/([\w-]+)\/(events|cancel|status)$/)]: ["GET /api/optimize/<id>/events", "POST /api/optimize/<id>/cancel", "GET /api/optimize/<id>/status"],
};

test("[smoke] api routes: the parsers read string and RegExp paths and the map's keys", () => {
  assert.deepEqual(registered("x.mts", `{ method: "GET", path: "/api/a", handle }\n{ method: "*", path: /^\\/api\\/runs\\/([\\w-]+)$/, handle }\n{ method: "DELETE", path: /^\\/api\\/c\\/[^/]+$/i, handle }`).map((r) => [r.method, String(r.path)]),
    [["GET", "/api/a"], ["*", "/^\\/api\\/runs\\/([\\w-]+)$/"], ["DELETE", "/^\\/api\\/c\\/[^/]+$/i"]]);
  assert.deepEqual(mapKeys(`export interface ApiRoutes {\n  // a\n  "GET /api/a/<id>": Untyped;\n}\n`), [{ method: "GET", path: "/api/a/<id>" }]);
  assert.equal(sample("/api/optimize/<id>/events"), "/api/optimize/123/events");
});

test("[smoke] api routes: every /api route serves its map entries and every entry has a route", () => {
  const dir = join(root, "app/http/routes");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mts") && !f.endsWith(".test.mts"));
  const unread: string[] = [], unanchored: string[] = [];
  const all = files.flatMap((f) => {
    const text = readFileSync(join(dir, f), "utf8"), got = registered(f, text), written = text.match(/\bmethod:/g)?.length ?? 0;
    if (got.length !== written) unread.push(`${f}: ${written} \`method:\` but ${got.length} routes read; write each as { method: "X", path: "/…" | /^…/, handle }`);
    return got;
  });
  for (const r of all) if (typeof r.path !== "string" && !r.path.source.startsWith("^")) unanchored.push(`${r.file}: ${String(r.path)} is not anchored with ^`);
  const routes = all.filter(isApi), keys = mapKeys(readFileSync(join(root, "app/api/routes.mts"), "utf8"));
  assert.ok(routes.length >= 50 && keys.length >= 50, `read ${routes.length} routes and ${keys.length} map entries`);
  const keyText = (k: { method: string; path: string }): string => `${k.method} ${k.path}`;
  const wrong = routes.flatMap((r) => {
    const served = keys.filter((k) => serves(r, k.method, sample(k.path))).map(keyText), want = FAN_OUT[String(r.path)];
    if (want) return [...served].sort().join("|") === [...want].sort().join("|") ? [] : [`${r.file}: ${r.method} ${String(r.path)} serves ${served.join(", ") || "no entry"}, FAN_OUT says ${want.join(", ")}`];
    return served.length === 1 ? [] : [`${r.file}: ${r.method} ${String(r.path)} serves ${served.length ? served.join(", ") : "no entry in app/api/routes.mts"} (one expected, or list it in FAN_OUT)`];
  });
  const unserved = keys.filter((k) => !routes.some((r) => serves(r, k.method, sample(k.path)))).map((k) => `${keyText(k)}: no route in app/http/routes/ serves it`);
  const stale = Object.keys(FAN_OUT).filter((p) => !routes.some((r) => String(r.path) === p)).map((p) => `FAN_OUT names ${p}, which no route registers`);
  assert.deepEqual([...unread, ...unanchored, ...wrong, ...unserved, ...stale], []);
});
