// static.mts — the page and the browser-shared modules: GET / (index.html), the favicon and logo, each module the page imports at run time (/<name>.mjs, compiled into app/dist/), GET /ui/<name> and GET /ui/fonts/<name>.woff2.
//
// The routes, what each takes and answers:
// - `GET /` (index.html)
// - `GET /favicon.png` (app/assets/, the logo at 64 px)
// - `GET /logo-mark.png` (the rat's head cropped from the logo, 80 px, the sidebar's mark)
// - `GET /<path>.mjs` for each shared module the page imports at run time: every `app/<path>.*` entry of tsconfig.browser.json's `include`, read once at start (`SHARED_MODULES`), served from app/dist/<path>.mjs; any other `.mjs` path is passed on to the routes after it
// - `GET /ui/<name>` (name matching /^[a-z0-9-]+\.(mjs|css)$/, served from app/ui/, else 404)
// - `GET /ui/fonts/<name>.woff2` (the bundled IBM Plex faces, app/ui/fonts/, as binary font/woff2)
//
// map: server
// owns: `routes`, `SHARED_MODULES`
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { send } from "../respond.mts";
import { APP_DIR, ROOT_DIR } from "../../config.mts";
import { NEXT, type Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

const HERE = APP_DIR;
// The page is served from app/dist/, never from the source tree: app/ui/*.mts and the shared
// modules are TypeScript, which no browser can parse. `npm run build:ui` (tsc -p
// tsconfig.browser.json) emits a .mjs for each of them here, rewriting every ./x.mts specifier to
// ./x.mjs on the way out, so the URLs the page fetches are exactly the ones it fetched before.
const WEB = join(HERE, "dist");
const UI_NAME_RE = /^[a-z0-9-]+\.(mjs|css)$/;
const FONT_NAME_RE = /^[a-z0-9-]+\.woff2$/;
// The shared modules' URLs ("/vault-lib.mjs", "/solver/scoring.mjs"): one per `app/<path>.*` entry of
// tsconfig.browser.json's include, the list tsc compiles for the page (the app/ui/ and app/api/ folders and the
// .d.mts types are not single modules, so they don't match). scripts/layering.test.mts checks that every module the
// page reaches outside app/ui/ is on it.
export const SHARED_MODULES: string[] = (JSON.parse(readFileSync(join(ROOT_DIR, "tsconfig.browser.json"), "utf8")) as { include: string[] }).include
  .flatMap((entry) => { const m = /^app\/([\w/-]+)\.\*$/.exec(entry); return m ? [`/${m[1]}.mjs`] : []; });
const SHARED = new Set(SHARED_MODULES);

export function routes(_ctx: ServerContext): Route[] {
  return [
    { method: "GET", path: "/", handle: (_req, res) => send(res, 200, readFileSync(join(HERE, "index.html"), "utf8"), "text/html") },
    { method: "GET", path: "/favicon.png", handle: (_req, res) => send(res, 200, readFileSync(join(HERE, "assets", "favicon.png")), "image/png") },
    { method: "GET", path: "/logo-mark.png", handle: (_req, res) => send(res, 200, readFileSync(join(HERE, "assets", "logo-mark.png")), "image/png") },
    { method: "GET", path: /^\/[\w/-]+\.mjs$/, handle: (_req, res, url) => (SHARED.has(url.pathname) ? send(res, 200, readFileSync(join(WEB, url.pathname.slice(1)), "utf8"), "text/javascript") : NEXT) },
    { method: "GET", path: /^\/ui\/fonts\//, handle: (_req, res, url) => {
      // One flat folder of woff2 files and nothing else: the licence texts next to them, a subfolder or
      // a dot-dot never match the name pattern.
      const name = url.pathname.slice("/ui/fonts/".length);
      const f = join(HERE, "ui", "fonts", name);
      if (!FONT_NAME_RE.test(name) || !existsSync(f)) return send(res, 404, { ok: false, error: "not found" });
      return send(res, 200, readFileSync(f), "font/woff2");
    } },
    { method: "GET", path: /^\/ui\//, handle: (_req, res, url) => {
      const name = url.pathname.slice("/ui/".length);
      if (!UI_NAME_RE.test(name)) return send(res, 404, { ok: false, error: "not found" });
      // Modules come from the build (app/dist/ui/), stylesheets from the source tree: tsc emits only
      // what it compiles, so styles.css never appears in app/dist/. Splitting here keeps one URL space
      // (/ui/<name>) over two directories rather than adding a copy step to the build.
      const f = name.endsWith(".css") ? join(HERE, "ui", name) : join(WEB, "ui", name);
      if (!existsSync(f)) return send(res, 404, { ok: false, error: "not found" });
      return send(res, 200, readFileSync(f, "utf8"), name.endsWith(".css") ? "text/css" : "text/javascript");
    } },
  ];
}
