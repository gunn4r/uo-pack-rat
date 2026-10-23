// site-minify.test.mts — the deployed website is minified (scripts/site-minify.mts, run by site-build.mts): the built page has no HTML or CSS comments and its inline scripts still compile, the demo's ES modules still import each other and run, and the HTML pass keeps the one space inline text needs while dropping whitespace between blocks.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { transformSync } from "esbuild";
import { buildSite } from "./site-build.mts";
import { minifyHtml } from "./site-minify.mts";

test("[fast] site-minify: the built page has no HTML or CSS comments, and every inline script still compiles", (t) => {
  const out = mkdtempSync(join(tmpdir(), "packrat-site-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  buildSite({ out: join(out, "site") });
  const html = readFileSync(join(out, "site", "index.html"), "utf8");
  assert.ok(!html.includes("<!--"), "no HTML comments");
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
  assert.ok(styles.length > 0 && styles.every((css) => !/\/\*(?!!)/.test(css)), "no CSS comments (a /*! licence would stay)");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  assert.ok(scripts.length >= 3, "the head, headline and page scripts");
  for (const js of scripts) assert.doesNotThrow(() => new Script(js), js.slice(0, 60));
  assert.ok(html.length < readFileSync(join(import.meta.dirname, "..", "site", "index.html"), "utf8").length * 0.9, "smaller than the source");
});

test("[fast] site-minify: the demo's modules keep their relative imports and exports, and still import and run", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "packrat-site-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const rec = join(out, "rec");
  mkdirSync(join(rec, "ui"), { recursive: true });
  writeFileSync(join(rec, "ui", "parts.mjs"), "// a part\nexport const greeting = (name) => `hello ${name}`;\nexport default 42;\n");
  writeFileSync(join(rec, "ui", "app.mjs"), "/* the app */\nimport answer, { greeting } from \"./parts.mjs\";\nexport function run() { return greeting(\"Dorran\") + \" \" + answer; }\n");
  writeFileSync(join(rec, "ui", "app.css"), "/* a comment */\n.app { color: red; }\n");
  buildSite({ out: join(out, "site"), demo: rec });
  const demo = join(out, "site", "demo");
  const app = readFileSync(join(demo, "ui", "app.mjs"), "utf8");
  assert.match(app, /from"\.\/parts\.mjs"/);
  assert.ok(!app.includes("the app"), "comments gone");
  assert.equal(readFileSync(join(demo, "ui", "app.css"), "utf8").trim(), ".app{color:red}");
  const mod = (await import(pathToFileURL(join(demo, "ui", "app.mjs")).href)) as { run(): string };
  assert.equal(mod.run(), "hello Dorran 42");
  // The shim from site/demo/ keeps its own imports, and every module in the built demo still parses as an ES module.
  assert.match(readFileSync(join(demo, "shim.mjs"), "utf8"), /from"\.\/item-query\.mjs".*from"\.\/hold-scroll\.mjs"|from"\.\/hold-scroll\.mjs".*from"\.\/item-query\.mjs"/s);
  const modules = readdirSync(demo, { recursive: true }).map(String).filter((f) => f.endsWith(".mjs"));
  for (const f of modules) assert.doesNotThrow(() => transformSync(readFileSync(join(demo, f), "utf8"), { loader: "js", format: "esm" }), f);
});

test("[fast] site-minify: whitespace collapses to one space in inline text and goes between blocks; comments go; <pre> stays", () => {
  assert.equal(minifyHtml("<div>\n  <p>One <b>two</b>\n  <i>three</i>  four</p>\n  <!-- note -->\n</div>"), "<div><p>One <b>two</b> <i>three</i> four</p></div>");
  assert.equal(minifyHtml("<p>a</p>\n<pre>  keep\n   this </pre>"), "<p>a</p><pre>  keep\n   this </pre>");
  assert.equal(minifyHtml("<span>icon</span>\n<img src=x alt=\"\">"), "<span>icon</span> <img src=x alt=\"\">", "a space beside an inline image can show, so it stays");
  assert.equal(minifyHtml("<style>\n/* c */\na { color: red }\n</style>\n<script>\n// c\nvar x = 1 ;\n</script>"), "<style>a{color:red}</style><script>var x=1;</script>");
});
