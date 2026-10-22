// site-build.test.mts — the website as it deploys (scripts/site-build.mts): every file the page links resolves in the built folder, latest.json and the recorded demo land beside it, the download buttons work without it, and the build refuses a folder inside site/ or one already full.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./site-build.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGES = "https://gunn4r.github.io/uo-pack-rat/";

// Every URL the page and its inline CSS name: src, href, srcset, url(...) and the og:image.
function linksOf(html: string): string[] {
  const attrs = [...html.matchAll(/\s(?:src|href|content)="([^"]+)"/g)].map((m) => m[1]!);
  const css = [...html.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]!);
  return [...attrs, ...css].filter((u) => !u.startsWith("data:"));
}

test("[fast] site-build: every file the page links is in the built site, the shared pictures and fonts included", (t) => {
  const out = mkdtempSync(join(tmpdir(), "packrat-site-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  buildSite({ out: join(out, "site") });
  const html = readFileSync(join(out, "site", "index.html"), "utf8");
  // Local files, relative to the page; the share image by its absolute Pages URL.
  const local = linksOf(html).map((u) => u.startsWith(PAGES) ? u.slice(PAGES.length) : u)
    .filter((u) => !/^(https?:|mailto:|#)/.test(u) && /\.\w+$/.test(u));
  assert.ok(local.length > 20, `the page links its images and fonts (found ${local.length})`);
  const missing = local.filter((u) => !existsSync(join(out, "site", u)));
  assert.deepEqual(missing, [], "files the page links but the build left out");
  assert.ok(!existsSync(join(out, "site", "latest.json")), "no latest.json unless given");
});

test("[fast] site-build: latest.json is copied in, and every download button links the latest release without it", (t) => {
  const out = mkdtempSync(join(tmpdir(), "packrat-site-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const latest = join(out, "latest.json");
  writeFileSync(latest, '{"version":"9.9.9"}');
  buildSite({ out: join(out, "site"), latest });
  assert.equal(JSON.parse(readFileSync(join(out, "site", "latest.json"), "utf8")).version, "9.9.9");
  const html = readFileSync(join(ROOT, "site", "index.html"), "utf8");
  const buttons = [...html.matchAll(/<a [^>]*data-key="([^"]+)"[^>]*href="([^"]+)"/g)];
  assert.deepEqual(buttons.map((m) => m[1]).sort(), ["linux", "mac-arm64", "mac-x64", "win", "win-portable"]);
  for (const [, key, href] of buttons) assert.equal(href, "https://github.com/gunn4r/uo-pack-rat/releases/latest", key);
});

test("[fast] site-build: the recorded demo goes in demo/, beside the shim from site/demo/", (t) => {
  const out = mkdtempSync(join(tmpdir(), "packrat-site-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  mkdirSync(join(out, "rec"));
  writeFileSync(join(out, "rec", "demo-data.json"), "{}");
  buildSite({ out: join(out, "site"), demo: join(out, "rec") });
  assert.ok(existsSync(join(out, "site", "demo", "demo-data.json")));
  assert.ok(existsSync(join(out, "site", "demo", "shim.mjs")), "the shim comes from site/demo/");
  assert.ok(!existsSync(join(out, "site", "demo", "hold-scroll.d.mts")), "type declarations stay out of the site");
});

test("[fast] site-build: refuses to build inside site/ or into a folder that isn't empty", (t) => {
  assert.throws(() => buildSite({ out: join(ROOT, "site", "dist") }), /outside site\//);
  const out = mkdtempSync(join(tmpdir(), "packrat-site-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  mkdirSync(join(out, "full"));
  writeFileSync(join(out, "full", "x"), "");
  assert.throws(() => buildSite({ out: join(out, "full") }), /not empty/);
});

test("[fast] site-build: the character section's tooltip is the Mighty Ring's own, every line from the demo fixture and nothing else", () => {
  const html = readFileSync(join(ROOT, "site", "index.html"), "utf8");
  const box = /<div class="tip" data-item="Mighty Ring">(.*?)<\/div>/.exec(html)?.[1] ?? "";
  const shown = [...box.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]!);
  const fixture = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", "demo-Dorran.json"), "utf8"));
  const ring = JSON.stringify(fixture).match(/"name":"Mighty Ring"[^}]*"tooltip":(\[[^\]]*\])/);
  assert.ok(ring, "the Mighty Ring is in the demo fixture");
  assert.deepEqual([...shown].sort(), [...(JSON.parse(ring[1]!) as string[])].sort());
});
