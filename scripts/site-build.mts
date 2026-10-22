#!/usr/bin/env node
// site-build.mts — assembles the website (issue #537) into one folder for GitHub Pages: `site/`, the repo's own pictures and fonts the page uses (COPIES), latest.json and the live demo when given.
//   npm run site:build -- --out <folder> [--latest <latest.json>] [--demo <folder from npm run site:demo>]
//
// The page has no build step of its own: this only gathers files, so the logo, the README's in-game captures and the app's mono font are copied from where they live rather than kept twice. The Pages workflow (`.github/workflows/pages.yml`) runs it with the latest.json from `scripts/site-latest.mts`; locally, serve the folder (`python3 -m http.server -d <folder>`) to see the page as it deploys. Without latest.json the download buttons link the Releases page; without the demo the page shows a screenshot where the live app would be.
//
// map: tooling
// owns: `buildSite`, `COPIES`
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE = join(ROOT, "site");

// [source in the repo, path in the built site]: the files the page uses that live elsewhere in the repo.
export const COPIES: Array<[string, string]> = [
  ["app/assets/logo-mark.png", "img/logo-mark.png"],
  ["app/assets/icon.png", "img/icon.png"],
  ["docs/images/put-away-trip.gif", "img/put-away-trip.gif"],
  ["docs/images/grab-game.gif", "img/grab-game.gif"],
  ["docs/images/ingame-panel.jpg", "img/ingame-panel.jpg"],
  ["app/ui/fonts/ibm-plex-mono-latin-400-normal.woff2", "fonts/ibm-plex-mono-latin-400-normal.woff2"],
  ["app/ui/fonts/ibm-plex-mono-latin-500-normal.woff2", "fonts/ibm-plex-mono-latin-500-normal.woff2"],
  ["app/ui/fonts/OFL-IBM-Plex-Mono.txt", "fonts/OFL-IBM-Plex-Mono.txt"],
];

// The site in `out`, which must be new or empty and outside `site/`; with `latest`, that file as latest.json; with
// `demo`, the recorded demo (scripts/site-demo.mts) in demo/, beside the shim from site/demo/.
export function buildSite({ out, latest = null, demo = null }: { out: string; latest?: string | null; demo?: string | null }): void {
  const to = resolve(out);
  // On another drive (Windows) relative() is absolute, which is outside too.
  const rel = relative(SITE, to);
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error(`build the site outside site/, not in ${to}`);
  if (existsSync(to) && readdirSync(to).length) throw new Error(`${to} is not empty`);
  mkdirSync(to, { recursive: true });
  cpSync(SITE, to, { recursive: true });
  for (const [from, at] of COPIES) {
    mkdirSync(dirname(join(to, at)), { recursive: true });
    cpSync(join(ROOT, from), join(to, at));
  }
  if (latest) cpSync(latest, join(to, "latest.json"));
  if (demo) cpSync(demo, join(to, "demo"), { recursive: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag: string): string | null => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] ?? null : null; };
  const out = value("--out");
  if (!out) { console.error("usage: npm run site:build -- --out <folder> [--latest <latest.json>] [--demo <folder>]"); process.exit(2); }
  try { buildSite({ out, latest: value("--latest"), demo: value("--demo") }); console.log(`site built in ${resolve(out)}`); } catch (e) { console.error((e as Error).message); process.exit(1); }
}
