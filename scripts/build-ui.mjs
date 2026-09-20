#!/usr/bin/env node
// build-ui.mjs — compile the browser-facing TypeScript (app/ui/**, vault-lib.*, item-query.*,
// scan-schema.*, schema/validate.*) via tsconfig.browser.json into app/dist/, which is what
// vault-server.mjs actually serves the page from (never the source tree — see its own header
// comment). Unlike build-core.mjs's hand-rolled node:module type stripping, this needs the real
// tsc: module resolution across app/ui/*.mts, not a single paste-able file stripped in isolation.
//
// Always runs — no mtime freshness check. tsc itself already skips unchanged files internally
// (it's a project build, not a from-scratch one every time), and a from-scratch mtime comparison
// here would have to track 20+ input files against 20+ outputs and would drift the moment either
// side gains a file; simpler and safer to let the compiler decide.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const TSCONFIG = join(ROOT, "tsconfig.browser.json");
// tsc emits app/ui/app.mts (the page's entry module) last among the files that matter here — its
// presence is what "app/dist already has a built page" means, for the no-compiler fallback below.
const UI_ENTRY_OUT = join(ROOT, "app", "dist", "ui", "app.mjs");

// Resolve the installed `typescript` package's own `tsc` entry point (its package.json `bin` field)
// rather than hard-coding `node_modules/typescript/bin/tsc` or shelling out to `npx`/a PATH lookup —
// `import.meta.resolve` uses Node's real ESM resolver (respects `typescript`'s `exports` map, works
// whether the package is hoisted to the repo root or nested), and doesn't depend on a network call
// or a globally-installed tsc the way `npx` would.
function resolveTscEntry() {
  let pkgUrl;
  try {
    pkgUrl = import.meta.resolve("typescript/package.json");
  } catch {
    return null; // the `typescript` devDependency isn't installed — see the packaged-app fallback in buildUi()
  }
  const pkgPath = fileURLToPath(pkgUrl);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsc;
  if (!bin) return null;
  return join(dirname(pkgPath), bin);
}

export function buildUi({ tsconfig = TSCONFIG } = {}) {
  const tscEntry = resolveTscEntry();
  if (!tscEntry || !existsSync(tscEntry)) {
    // The packaged Electron app ships no devDependencies (electron-builder's `files` list excludes
    // them) — it carries a pre-built app/dist/ instead (see electron/server-entry.mjs's header:
    // it never calls buildCore() either, for the same reason). Only tolerate a missing compiler
    // when there's already a built page to fall back to; otherwise this must fail loudly rather
    // than serve a stale or absent page with no explanation.
    // Say so when it happens (the packaged app never calls buildUi() at all — electron/server-entry.mjs
    // does no building — so this is always a source checkout): it means the page
    // being served is whatever was last built, not the sources on disk (`npm ci --omit=dev` followed
    // by a branch switch is the way to get here), and that must not pass silently.
    if (existsSync(UI_ENTRY_OUT)) {
      console.warn("build-ui: no TypeScript compiler installed — serving the existing app/dist/ as-is, which may be stale. Run `npm install` to rebuild the page from source.");
      return UI_ENTRY_OUT;
    }
    throw new Error("the TypeScript compiler isn't installed (no `typescript` package found) and app/dist/ui/app.mjs doesn't exist yet — run `npm install`");
  }
  // TypeScript 7 is the native compiler: bin/tsc is a small JS launcher that finds and runs a
  // platform-specific binary from one of typescript's optionalDependencies. Spawning the launcher
  // under process.execPath keeps this free of any PATH or shebang dependency; if the native binary
  // is missing (`npm ci --omit=optional`, an unlisted platform) the launcher exits non-zero and the
  // throw below surfaces its message rather than serving a stale page.
  const result = spawnSync(process.execPath, [tscEntry, "-p", tsconfig], { cwd: ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`tsc -p ${relative(ROOT, tsconfig)} failed (exit ${result.status}):\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return UI_ENTRY_OUT;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(buildUi());
