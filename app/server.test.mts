// server.test.mts — HTTP tests of what every route shares, against a real listening server (ephemeral port, temp data folder): the page and its static routes, the CSP and framing headers, the Host/Origin/token middleware, body checks, the stack-free 500, timeouts, and the server's lifecycle (close, a busy port, atomic writes). The routes themselves are in app/server-<family>.test.mts. Tags: [smoke] and [fast]. Run: node --test app/server.test.mts
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, cpSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createConnection } from "node:net";
import { resolveConfig, ensureLayout } from "./config.mts";
import type { ServerHandle } from "./vault-server.mts";
import { startTestServer as startServer } from "./server-fixture.mts";
import { buildPools, setRules } from "./vault-lib.mts";
import { buildUi } from "../scripts/build-ui.mts";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import { asJson, HERE, UOALIVE, foldFixtures, rawReq, sseReader, JSON_HEADERS, logText, type InventoryResponse, type ProfilesResponse, type RulesResponse, type OptimizeJobResponse, type ErrorBody } from "./server-routes-fixture.mts";

// Order matters: build the schema types before buildUi() runs, not because tsconfig.browser.json's
// `include` enforces it (a missing literal entry there is silently dropped, not an error — verified)
// but because this call is the only actual guarantee app/schema/types.d.mts exists before anything
// imports from it. Also so a bare `node --test app/server.test.mts` works on a fresh clone (no
// pretest hook run). The optimizer core needs no build step of its own — startServer() below resolves
// it straight from source via config.mts's paths.core (PACKRAT_CORE overrides it).
buildSchemaTypes();
buildUi();   // this file's own route tests fetch /ui/app.mjs and /vault-lib.mjs from app/dist/
setRules(UOALIVE);
afterEach(() => setRules(UOALIVE));
// node:test does not wait for an async before() when a tag filter (--smoke) leaves a file no test to run, so after()
// waits for the start itself rather than closing a server that is not up yet.
let srv: ServerHandle, srvStarted: Promise<unknown> = Promise.resolve();
before(() => (srvStarted = startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-"))], {}))).then((s) => { srv = s; })));
after(async () => { await srvStarted; await srv?.close(); });
const get = (p: string): Promise<Response> => fetch(srv.url + p);

test("[smoke] / serves the page with a CSP and no inline script", async () => {
  const r = await get("/"); assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy") || "", /script-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("[smoke] / has no inline <script>", async () => {
  const r = await get("/");
  assert.doesNotMatch(await r.text(), /<script(?![^>]*\bsrc=)/, "no inline <script>");
});

test("[fast] /ui/ rejects traversal and unlisted files", async () => {
  assert.equal((await get("/ui/../vault-server.mts")).status, 404);
  assert.equal((await get("/ui/nope.mjs")).status, 404);
});

test("[fast] /ui/app.mjs is served with the right content-type", async () => {
  assert.equal((await get("/ui/app.mjs")).status, 200);
  assert.equal((await get("/ui/app.mjs")).headers.get("content-type"), "text/javascript; charset=utf-8");
});

// ui/shard.mts (Important 3's fix: changeShard(), shared by the header picker and the wizard's shard
// step) is just another file under app/ui/ — the /ui/<name> allowlist route needs no per-file
// registration, but a new module is still worth a one-line proof it's actually reachable.
test("[fast] /ui/shard.mjs is served with the right content-type", async () => {
  assert.equal((await get("/ui/shard.mjs")).status, 200);
  assert.equal((await get("/ui/shard.mjs")).headers.get("content-type"), "text/javascript; charset=utf-8");
});

// The bundled IBM Plex faces (app/ui/tokens.css's @font-face) come from app/ui/fonts/, byte for byte,
// as font/woff2 with no charset: a font sent as text would be refused by the browser, and the CSP's
// font-src 'self' allows exactly this origin. Anything but a flat .woff2 name in that folder is a 404.
test("[fast] /ui/fonts/ serves the bundled woff2 files as binary font/woff2", async () => {
  const name = "ibm-plex-sans-latin-400-normal.woff2";
  const res = await get(`/ui/fonts/${name}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "font/woff2");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), readFileSync(join(HERE, "ui", "fonts", name)));
  for (const bad of ["/ui/fonts/OFL-IBM-Plex-Sans.txt", "/ui/fonts/nope.woff2", "/ui/fonts/..%2fstyles.css", "/ui/fonts/sub/x.woff2"]) {
    assert.equal((await get(bad)).status, 404, bad);
  }
});

test("[fast] the page's stylesheets and fonts are allowed by its own CSP", async () => {
  const csp = (await get("/")).headers.get("content-security-policy") || "";
  assert.match(csp, /font-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /img-src 'self' data:/, "the Britannia theme's frame and texture are inline data: images");
  for (const css of ["tokens.css", "britannia.css", "components.css", "styles.css"]) assert.equal((await get(`/ui/${css}`)).status, 200, css);
  assert.equal((await get("/ui/fonts/cinzel-latin-600-normal.woff2")).status, 200, "Britannia's display face");
});

// scan-schema.mjs (served at /scan-schema.mjs) imports validate() from "./schema/validate.mjs" — the
// browser resolves that relative import against scan-schema.mjs's own served URL, so it 404s without
// this route. Caught live by the Task 2 browser check (a bootstrap import chain failure with no other
// visible symptom besides a stuck "loading…" status and one console error).
test("[fast] /schema/validate.mjs is servable (scan-schema.mjs's own relative import)", async () => {
  const r = await get("/schema/validate.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await r.text(), /export function validate/);
});

test("[fast] /paste-scan.mjs is servable (the Import drawer's preview parses with the server's rule)", async () => {
  const r = await get("/paste-scan.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await r.text(), /export function parsePastedScan/);
});

test("[fast] /favicon.png is the logo, served same-origin as image/png, and the page links it", async () => {
  const r = await get("/favicon.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const body = Buffer.from(await r.arrayBuffer());
  assert.deepEqual(body, readFileSync(join(dirname(fileURLToPath(import.meta.url)), "assets", "favicon.png")), "the bytes arrive unaltered, not re-encoded as text");
  assert.match(await (await get("/")).text(), /<link rel="icon" type="image\/png" href="\/favicon\.png">/);
});

// The sidebar's mark is the rat's head cropped from the logo (build/README.md), 80 px so its 40 px circle is
// sharp on a 2x screen; the full logo stays the favicon and the window icon.
test("[fast] /logo-mark.png is the sidebar's mark, served as image/png, and the sidebar's brand uses it", async () => {
  const r = await get("/logo-mark.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  const body = Buffer.from(await r.arrayBuffer());
  assert.deepEqual(body, readFileSync(join(dirname(fileURLToPath(import.meta.url)), "assets", "logo-mark.png")));
  assert.deepEqual([body.readUInt32BE(16), body.readUInt32BE(20)], [80, 80], "80 × 80: a 40 px circle at 2x");
  assert.match(await (await get("/")).text(), /<div class="brand"><img src="\/logo-mark\.png"/);
});

test("[fast] writes require application/json", async () => {
  const r = await fetch(srv.url + "/api/profiles", { method: "PUT", body: "{}" });
  assert.equal(r.status, 415);
});

// A build in progress keeps its SSE client's response "waiting for a response", which is exactly
// what server.close() waits out by default — without ending those streams first, close() would hang
// on the connection's keep-alive idle timeout (seconds) instead of resolving once the workers stop.
test("[fast] close() ends open SSE streams instead of waiting out their keep-alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates!)[0]!;
    const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json", "x-client-id": "close-test-client" },
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } }),
    });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    // The events route requires ?client= to match the job's own clientId (the X-Client-Id header sent
    // above) since the null-clientId collision fix — omitting it now correctly 403s (see the two tests
    // in the "localhost security" section below that check that directly).
    const events = await fetch(s2.url + `/api/optimize/${id}/events?client=close-test-client`);
    assert.equal(events.status, 200);
    const first = await events.body!.getReader().read();   // "hello" — proves the client attached while the job was running
    assert.match(new TextDecoder().decode(first.value), /event: hello/);
    const t0 = Date.now();
    await s2.close();
    assert.ok(Date.now() - t0 < 1000, `close() took ${Date.now() - t0}ms`);
  } finally {
    await s2.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Task 4: localhost security — token, Host/Origin, profiles size cap + schema, one job per
// X-Client-Id, stack-free 500s. A second, dedicated server with --token "t0ken", so the bare `srv`
// above (used by every test above this line) stays token-free and untouched. Flat test()s, not a
// describe() block: the test runner (scripts/test-runner.mts) only tallies nesting-0 tests, so a
// describe() would fold all of these into a single pass/fail and drop them from the per-test count.
let tsrv: ServerHandle, tdir: string, tsrvStarted: Promise<unknown> = Promise.resolve();
before(() => {
  tdir = mkdtempSync(join(tmpdir(), "qm-sec-"));
  return (tsrvStarted = startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", tdir, "--token", "t0ken"], {}))).then((s) => { tsrv = s; }));
});
after(async () => { await tsrvStarted; await tsrv?.close(); });
const authHost = () => ({ host: `localhost:${tsrv.port}`, authorization: "Bearer t0ken" });

test("[fast] /api/inventory: no token is 401, the right bearer token is 200", async () => {
  const noAuth = await rawReq(`${tsrv.url}/api/inventory`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(noAuth.status, 401);
  assert.equal(asJson(noAuth.json()).ok, false);
  const withAuth = await rawReq(`${tsrv.url}/api/inventory`, { headers: authHost() });
  assert.equal(withAuth.status, 200);
});

test("[fast] static / and /ui/app.mjs need no token", async () => {
  const root = await rawReq(`${tsrv.url}/`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(root.status, 200);
  const uiApp = await rawReq(`${tsrv.url}/ui/app.mjs`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(uiApp.status, 200);
});

test("[fast] a forged Host is 403", async () => {
  const r = await rawReq(`${tsrv.url}/api/inventory`, { headers: { host: "evil.example", authorization: "Bearer t0ken" } });
  assert.equal(r.status, 403);
});

test("[fast] a forged Origin is 403; the server's own origin is accepted", async () => {
  const bad = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: "http://evil.example" } });
  assert.equal(bad.status, 403);
  const good = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: `http://127.0.0.1:${tsrv.port}` } });
  assert.equal(good.status, 200);
});

// Test gap noted in review: only forged Origin values were covered, not the literal "null" string a
// browser sends for a sandboxed iframe or a file:// page — that's a real string, not an absent
// header, and must not slip past `origin != null`.
test("[fast] Origin: null (a sandboxed iframe / file:// origin) is 403", async () => {
  const r = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: "null" } });
  assert.equal(r.status, 403);
});

// Test gap noted in review: the Host tests above all go through node:http, which always sends SOME
// Host header. A raw HTTP/1.0 request (Host is optional in that version) proves the check refuses a
// genuinely absent Host, not just a forged one.
test("[fast] a raw HTTP/1.0 request with no Host header at all is 403", async () => {
  const raw = await new Promise<string>((resolve, reject) => {
    const sock = createConnection({ port: tsrv.port, host: "127.0.0.1" }, () => {
      sock.write("GET /api/inventory HTTP/1.0\r\nAuthorization: Bearer t0ken\r\n\r\n");
    });
    let buf = "";
    sock.on("data", (c: Buffer) => { buf += c.toString("utf8"); });
    sock.on("end", () => resolve(buf));
    sock.on("error", reject);
  });
  assert.match(raw, /^HTTP\/1\.[01] 403\b/);
});

// A profiles.json that is a directory is an I/O failure the route does not recover from (a truncated
// one is moved aside and reseeded instead), so it still reaches the catch-all 500.
test("[fast] a route that throws returns a stack-free 500 with a ref that appears in the log", async () => {
  rmSync(join(tdir, "profiles.json"), { force: true });
  mkdirSync(join(tdir, "profiles.json"));
  const r = await rawReq(`${tsrv.url}/api/profiles`, { headers: authHost() });
  assert.equal(r.status, 500);
  const body = asJson<ErrorBody>(r.json());
  assert.equal(body.error, "internal error");
  assert.ok(body.ref, "a ref is present");
  assert.doesNotMatch(r.text, /at file:|\.mjs:\d+:\d+/, "no stack trace text reaches the response body");
  const log = readFileSync(join(tdir, "logs", "server.log"), "utf8");
  assert.ok(log.includes(body.ref!), "the ref appears in the log file");
});

// ---------------------------------------------------------------------------------------------
// Task 4: the inventory cache, item-query.mjs's static route, GET /api/items, and POST
// /api/optimize's by-character form. Uses the module-level `srv` (--demo) where a fresh server
// isn't needed for isolation.

test("[smoke] /item-query.mjs is served as text/javascript with nosniff", async () => {
  const r = await get("/item-query.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(await r.text(), /export function applyItemQuery/);
});

test("[smoke] /organize-config.mjs, the rule editor's import, is served as text/javascript (issue #150)", async () => {
  const r = await get("/organize-config.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await r.text(), /export function ruleMatchOf/);
});

test("[smoke] /data-dir-notice.mjs, ui/messages.mts's import, is served as text/javascript", async () => {
  const r = await get("/data-dir-notice.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await r.text(), /export function dataDirNotice/);
});

test("[smoke] /buffs.mjs, Manual's buff catalog, is served as text/javascript (issue #12)", async () => {
  const r = await get("/buffs.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await r.text(), /export function applyBuffs/);
});

// ---- Phase 7 security review: the server's own hardening ------------------------------------------
// One block, one finding per test, each named after the property it pins rather than the bug it came
// from. Every test here was verified RED against the pre-fix server before the fix landed.

// Important 8: JSON.parse("null") is a perfectly well-formed body, and destructuring it is a
// TypeError — ten routes answered 500 and appended a full V8 stack to <data>/logs/server.log, which
// is neither rotated nor size-capped. One asObject() guard in front of them all.
const OBJECT_BODY_ROUTES: Array<[string, string]> = [
  ["PUT", "/api/settings"], ["POST", "/api/setup/locate"], ["POST", "/api/setup/install"],
  ["POST", "/api/import/paste"], ["POST", "/api/import/rescan"],
  ["POST", "/api/host/pick-folder"], ["POST", "/api/host/open-path"], ["POST", "/api/optimize"],
  ["POST", "/api/bridge"], ["POST", "/api/forget"], ["POST", "/api/forget-character"], ["PUT", "/api/ui-prefs"],
  ["POST", "/api/blacklist"], ["POST", "/api/retention/cleanup"],
];

test("[fast] a null/array/scalar JSON body is a clean 400 on every body-reading route, and the log does not grow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-nullbody-"));
  // A host stub, so the two /api/host/* routes get past their own 501 and reach the body read.
  const s2 = await startServer(
    ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})),
    { host: { pickFolder: async () => null, openPath: async () => {} } },
  );
  const log = join(dir, "logs", "server.log");
  const before = existsSync(log) ? readFileSync(log, "utf8").length : 0;
  try {
    for (const [method, path] of OBJECT_BODY_ROUTES) {
      for (const body of ["null", "[]", '"x"', "42"]) {
        const r = await fetch(s2.url + path, { method, headers: { "content-type": "application/json" }, body });
        assert.equal(r.status, 400, `${method} ${path} with body ${body}`);
        assert.equal(asJson<ErrorBody>(await r.json()).error, "body must be a JSON object");
      }
    }
    const after = existsSync(log) ? readFileSync(log, "utf8").length : 0;
    assert.equal(after, before, "a rejected body writes nothing to server.log");
  } finally {
    await s2.close();
  }
});

// Important 6 / area-4 minor 3: frame-ancestors has no default-src fallback, so `default-src 'none'`
// never delivered the "no framing" the comment claimed, and no X-Frame-Options was sent at all.
test("[smoke] / carries frame-ancestors 'none', and every response carries x-frame-options: DENY", async () => {
  const page = await get("/");
  assert.match(page.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  const json = await get("/api/inventory");
  assert.equal(json.headers.get("x-frame-options"), "DENY", "not just text/html");
});

// Minor 7: both timeouts were 0, so a socket that sent half a request line and then stopped was never
// closed. The old comment justified that with the exact solver's minutes-long searches — but those are
// on the RESPONSE side, which neither of these governs, and a finite requestTimeout leaves a long-lived
// SSE response alone (the request itself completed on connect). server.timeout, which WOULD cut a
// stream, stays disabled.
test("[fast] the server keeps finite header/request timeouts, and an SSE stream still streams under them", async () => {
  assert.ok(srv.server.headersTimeout > 0, "headersTimeout must not be disabled");
  assert.ok(srv.server.requestTimeout > 0, "requestTimeout must not be disabled");
  assert.equal(srv.server.timeout, 0, "the idle-socket timeout stays off — it would cut an SSE stream");
  const sse = sseReader(await get("/api/events"));
  try {
    await sse.readUntil((b) => b.includes("event: hello"));
  } finally {
    await sse.cancel();
  }
});

test("[fast] a malformed JSON body is a 400 naming the problem, with nothing logged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-badjson-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    for (const [method, path] of [["PUT", "/api/settings"], ["PUT", "/api/profiles"], ["POST", "/api/optimize"]] as const) {
      const r = await fetch(s2.url + path, { method, headers: JSON_HEADERS, body: "{not json" });
      assert.equal(r.status, 400, `${method} ${path}`);
      const body = asJson<ErrorBody>(await r.json());
      assert.match(body.error, /invalid JSON/);
      assert.equal(body.ref, undefined);
    }
    assert.equal(logText(dir), "", "no stack reaches the log for a caller's bad body");
  } finally {
    await s2.close();
  }
});

// A write through a temp file and a rename replaces the file's inode; writing in place (the old
// writeFileSync onto the live name, which a crash can leave truncated) keeps it.
test("[fast] settings, profiles and tombstones are replaced through a renamed temp file, created 0600, leaving no temp behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-atomic-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json()).profiles;
    const forget = () => fetch(s2.url + "/api/forget", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ root: 4660 }) });
    assert.equal((await forget()).status, 200);
    const files = [join(dir, "settings.json"), join(dir, "profiles.json"), join(dir, "scans", "_forget-1234.json")];
    const before = files.map((f) => statSync(f).ino);
    assert.equal((await fetch(s2.url + "/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ setupDone: true }) })).status, 200);
    assert.equal((await fetch(s2.url + "/api/profiles", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(profiles) })).status, 200);
    assert.equal((await forget()).status, 200);
    files.forEach((f, i) => {
      assert.notEqual(statSync(f).ino, before[i], `${f} was rewritten in place`);
      if (process.platform !== "win32") assert.equal(statSync(f).mode & 0o777, 0o600, f);
    });
    for (const d of [dir, join(dir, "scans")]) assert.deepEqual(readdirSync(d).filter((f) => f.endsWith(".new") || f.endsWith(".tmp")), [], d);
  } finally {
    await s2.close();
  }
});

test("[fast] a server that cannot bind its port starts no watcher and leaves the inbox alone", async () => {
  const blocker = http.createServer();
  await new Promise<void>((res) => blocker.listen(0, "127.0.0.1", res));
  const port = (blocker.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "qm-port-taken-"));
  const cfg = ensureLayout(resolveConfig(["--port", String(port), "--data", dir], {}));
  const fixture = readdirSync(join(HERE, "fixtures")).find((f) => /^demo-.*\.json$/.test(f))!;
  cpSync(join(HERE, "fixtures", fixture), join(dir, "inbox", "tazuo", fixture));
  try {
    await assert.rejects(startServer(cfg), /EADDRINUSE/);
    await new Promise((res) => setTimeout(res, 100));
    assert.ok(existsSync(join(dir, "inbox", "tazuo", fixture)), "the drop is still waiting for the server that does start");
    assert.deepEqual(readdirSync(join(dir, "scans")), []);
  } finally {
    await new Promise((res) => blocker.close(res));
  }
});
