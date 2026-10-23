// site-minify.mts — the website as deployed is minified: scripts/site-build.mts runs minifySite over the folder it assembled, so the repo keeps the readable, commented source and only the Pages artifact is compact.
//
// Every .css, .mjs and .js goes through esbuild's transform (minify; .mjs as an ES module, so imports, exports and relative paths stay as they are: nothing is bundled and no export is renamed). An HTML page's inline <style> and <script> blocks go through the same transform, and the HTML around them through minifyHtml, a small conservative pass: comments go, and whitespace collapses to one space, dropped only next to a block-level tag where it can't render. <pre> and <textarea> are left alone. esbuild keeps /*! */ and @license comments by default; the font licences are text files and ship as they are.
//
// map: tooling
// owns: `minifySite`, `minifyHtml`
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { transformSync } from "esbuild";

// Tags whose neighbouring whitespace never renders (block containers, the insides of an SVG): around them a whitespace
// run can go entirely. Inline elements (img, svg, a, button, ...) are not here: a space beside one can show.
const BLOCK = new Set(["html", "head", "body", "meta", "link", "title", "style", "script", "template", "noscript", "main", "header", "footer", "nav", "section", "article", "aside", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "figure", "figcaption", "table", "thead", "tbody", "tr", "td", "th", "form", "fieldset", "dialog", "hr", "br", "filter", "defs", "path", "g", "feturbulence", "fedisplacementmap", "animate", "circle", "rect", "option", "pre", "source"]);
const tagName = (tag: string): string => (/^<\/?([a-zA-Z][\w-]*)/.exec(tag)?.[1] ?? "").toLowerCase();

// The pass splits tags at the first ">", so an attribute value holding "<" or ">" (alt="a > b", a comment marker) would
// be cut and mangled: it stops the build instead. A tag that ends inside a quote is one whose value held a ">".
function checkTag(tag: string): void {
  let quote = "";
  for (const ch of tag.slice(1, -1)) {
    if (quote) { if (ch === quote) quote = ""; else if (ch === "<" || ch === ">") break; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "<") { quote = "<"; break; }
  }
  if (quote) throw new Error(`site-minify: an attribute holds "<" or ">", which the HTML pass can't keep intact; escape it as &lt; or &gt;: ${tag.slice(0, 120)}`);
}

const code = (source: string, loader: "css" | "js", module: boolean): string =>
  transformSync(source, { loader, minify: true, ...(module ? { format: "esm" as const } : {}) }).code.trim();

// One page: inline styles and scripts minified, comments gone, whitespace collapsed (see the header).
export function minifyHtml(html: string): string {
  // Blocks set aside, kept exactly, while the HTML around them is collapsed: a script, style or <pre> (marked \u0001,
  // block-level, so the whitespace beside it goes) or a <textarea> (marked \u0000, inline, so a space beside it stays).
  const kept: string[] = [];
  const keep = (s: string, mark = "\u0000"): string => `${mark}${kept.push(s) - 1}${mark}`;
  let out = html
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs: string, body: string) => keep(`<style${attrs}>${code(body, "css", false)}</style>`, "\u0001"))
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs: string, body: string) =>
      keep(`<script${attrs}>${body.trim() && !/\bsrc=/.test(attrs) ? code(body, "js", /type=["']?module/.test(attrs)) : body}</script>`, "\u0001"))
    .replace(/<(pre|textarea)\b[\s\S]*?<\/\1>/gi, (m, tag: string) => keep(m, tag.toLowerCase() === "pre" ? "\u0001" : "\u0000"))
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "");
  // Tags stand alone, text between them has its whitespace collapsed; a run that only separates tags goes when either
  // tag is a block-level one.
  const parts = out.split(/(<[^>]+>)/);
  for (let i = 1; i < parts.length; i += 2) checkTag(parts[i]!);
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i]!.replace(/\s+/g, " ");
    if (text === " ") {
      const before = i > 0 ? tagName(parts[i - 1]!) : "html", after = i + 1 < parts.length ? tagName(parts[i + 1]!) : "html";
      parts[i] = BLOCK.has(before) || BLOCK.has(after) || before === "" || after === "" ? "" : " ";
    } else parts[i] = text;
  }
  out = parts.join("").trim().replace(/ ?(\u0001\d+\u0001) ?/g, "$1");
  return out.replace(/([\u0000\u0001])(\d+)\1/g, (_, _mark: string, n: string) => kept[Number(n)]!);
}

// Every page, stylesheet and script under `dir`, minified in place.
export function minifySite(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { minifySite(path); continue; }
    const ext = extname(name);
    if (ext === ".html") writeFileSync(path, minifyHtml(readFileSync(path, "utf8")));
    else if (ext === ".css") writeFileSync(path, code(readFileSync(path, "utf8"), "css", false));
    else if (ext === ".mjs" || ext === ".js") writeFileSync(path, code(readFileSync(path, "utf8"), "js", ext === ".mjs"));
  }
}
