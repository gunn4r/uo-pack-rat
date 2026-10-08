// static.mts — the page and the browser-shared modules: GET / (index.html), the favicon and logo, each module the page imports at run time (/<name>.mjs, compiled into app/dist/), GET /ui/<name> and GET /ui/fonts/<name>.woff2.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { send } from "../respond.mts";
import { APP_DIR } from "../../config.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

const HERE = APP_DIR;
// The page is served from app/dist/, never from the source tree: app/ui/*.mts and the shared
// modules are TypeScript, which no browser can parse. `npm run build:ui` (tsc -p
// tsconfig.browser.json) emits a .mjs for each of them here, rewriting every ./x.mts specifier to
// ./x.mjs on the way out, so the URLs the page fetches are exactly the ones it fetched before.
const WEB = join(HERE, "dist");
const UI_NAME_RE = /^[a-z0-9-]+\.(mjs|css)$/;
const FONT_NAME_RE = /^[a-z0-9-]+\.woff2$/;

export function routes(_ctx: ServerContext): Route[] {
  return [
    { method: "GET", path: "/", handle: (_req, res) => send(res, 200, readFileSync(join(HERE, "index.html"), "utf8"), "text/html") },
    { method: "GET", path: "/favicon.png", handle: (_req, res) => send(res, 200, readFileSync(join(HERE, "assets", "favicon.png")), "image/png") },
    { method: "GET", path: "/logo-mark.png", handle: (_req, res) => send(res, 200, readFileSync(join(HERE, "assets", "logo-mark.png")), "image/png") },
    { method: "GET", path: "/vault-lib.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "vault-lib.mjs"), "utf8"), "text/javascript") },
    { method: "GET", path: "/item-query.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "item-query.mjs"), "utf8"), "text/javascript") },
    // The rule editor opens an Auto rule as the planner reads it (organize-config.mts's ruleMatchOf, issue #150).
    { method: "GET", path: "/organize-config.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "organize-config.mjs"), "utf8"), "text/javascript") },
    // Manual's buffs read the same catalog the server checks ui-prefs with (app/buffs.mts, issue #12).
    { method: "GET", path: "/buffs.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "buffs.mjs"), "utf8"), "text/javascript") },
    // Manual's totals and Automatic's buff picker evaluate a suit the way the server and the MCP tools do (app/evaluate.mts).
    { method: "GET", path: "/evaluate.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "evaluate.mjs"), "utf8"), "text/javascript") },
    // The Suit Builder's Advanced fields check against the server's run-setting ranges (app/run-settings.mts), which
    // import the request guards.
    { method: "GET", path: "/run-settings.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "run-settings.mjs"), "utf8"), "text/javascript") },
    // The Suit Builder plans a build, and reads and writes the profiles, through the server's own BuildSpec (app/build-spec.mts).
    { method: "GET", path: "/build-spec.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "build-spec.mjs"), "utf8"), "text/javascript") },
    // The Suit Builder's swing line and step hints use the solvers' own swing formula (app/swing.mts).
    { method: "GET", path: "/swing.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "swing.mjs"), "utf8"), "text/javascript") },
    { method: "GET", path: "/guards.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "guards.mjs"), "utf8"), "text/javascript") },
    { method: "GET", path: "/data-dir-notice.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "data-dir-notice.mjs"), "utf8"), "text/javascript") },
    { method: "GET", path: "/scan-schema.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "scan-schema.mjs"), "utf8"), "text/javascript") },
    // The Import drawer's instant preview parses a paste with the server's own rule (app/paste-scan.mts).
    { method: "GET", path: "/paste-scan.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "paste-scan.mjs"), "utf8"), "text/javascript") },
    // scan-schema.mjs imports validate() from here — the browser resolves that relative import
    // against scan-schema.mjs's own served URL, so this needs its own static route too.
    { method: "GET", path: "/schema/validate.mjs", handle: (_req, res) => send(res, 200, readFileSync(join(WEB, "schema", "validate.mjs"), "utf8"), "text/javascript") },
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
