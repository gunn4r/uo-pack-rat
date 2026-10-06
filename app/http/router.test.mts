// router.test.mts — `app/http/router.mts` on its own: which route answers a request.
//
// `app/http/router.mts`: the first route whose method and path match answers, in table order; a string path matched exactly and a RegExp handing its match on; `"*"` matching any method; `NEXT` passing a request to the next match; a known path with another method unanswered (the server's 404, never a 405); a handler that throws rejecting. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { dispatch, NEXT, type Route } from "./router.mts";
import type { ServerContext } from "./context.mts";

const ctx = {} as ServerContext, res = {} as http.ServerResponse;
const req = (method: string) => ({ method }) as http.IncomingMessage;
const at = (path: string) => new URL(`http://localhost${path}`);

test("[fast] router: method and path pick the first answering route, in table order", async () => {
  const seen: string[] = [];
  const routes: Route[] = [
    { method: "GET", path: "/a", handle: () => { seen.push("get a"); } },
    { method: "POST", path: "/a", handle: () => { seen.push("post a"); } },
    { method: "GET", path: /^\/a/, handle: () => { seen.push("never: /a already answered"); } },
    { method: "GET", path: /^\/runs\/(\w+)$/, handle: (_req, _res, _url, match) => { seen.push(`run ${match[1]}`); } },
  ];
  assert.equal(await dispatch(routes, req("GET"), res, at("/a"), ctx), true);
  assert.equal(await dispatch(routes, req("POST"), res, at("/a"), ctx), true);
  assert.equal(await dispatch(routes, req("GET"), res, at("/runs/x1"), ctx), true);
  assert.equal(await dispatch(routes, req("GET"), res, at("/a/b"), ctx), true, "a RegExp matches a prefix");
  assert.deepEqual(seen, ["get a", "post a", "run x1", "never: /a already answered"]);
  assert.equal(await dispatch(routes, req("DELETE"), res, at("/a"), ctx), false, "a known path with another method is not answered (a 404, never a 405)");
  assert.equal(await dispatch(routes, req("GET"), res, at("/b"), ctx), false);
});

test("[fast] router: \"*\" matches any method, NEXT passes the request on, the match of a string path is the path, and a throw rejects", async () => {
  const seen: string[] = [];
  const routes: Route[] = [
    { method: "*", path: /^\/job\/(\w+)$/, handle: async (r, _res, _url, match) => { seen.push(`${r.method} ${match[1]}`); return r.method === "GET" ? undefined : NEXT; } },
    { method: "POST", path: "/job/1", handle: (_req, _res, _url, match) => { seen.push(`post ${match[0]}`); } },
    { method: "PUT", path: "/boom", handle: () => { throw new Error("boom"); } },
  ];
  assert.equal(await dispatch(routes, req("GET"), res, at("/job/1"), ctx), true);
  assert.equal(await dispatch(routes, req("POST"), res, at("/job/1"), ctx), true);
  assert.equal(await dispatch(routes, req("DELETE"), res, at("/job/1"), ctx), false);
  assert.deepEqual(seen, ["GET 1", "POST 1", "post /job/1", "DELETE 1"]);
  await assert.rejects(dispatch(routes, req("PUT"), res, at("/boom"), ctx), /boom/);
});
