#!/usr/bin/env node
// build-ui.mts — compile the browser-facing TypeScript (app/ui/**, vault-lib.*, item-query.*,
// scan-schema.*, schema/validate.*) via tsconfig.browser.json into app/dist/, which is what
// vault-server.mts actually serves the page from (never the source tree — see its own header
// comment). Unlike the optimizer core (a single paste-able file Node runs from source with no build
// step at all), this needs the real tsc: module resolution across app/ui/*.mts.
//
// Always runs, from an empty app/dist/ — no mtime freshness check. tsc re-emits every file on each
// run (no incremental build is configured) and never deletes an output whose source is gone, so the
// folder is cleared first: a deleted app/ui file would otherwise stay servable from app/dist/.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const TSCONFIG = join(ROOT, "tsconfig.browser.json");
// tsc emits app/ui/app.mts (the page's entry module) last among the files that matter here — its
// presence is what "app/dist already has a built page" means, for the no-compiler fallback below.
const UI_ENTRY_OUT = join(ROOT, "app", "dist", "ui", "app.mjs");

// The one shape this file reads off the installed `typescript` package's own package.json — its
// `bin` field, which npm's own package.json spec allows as either a bare string (one binary, named
// after the package) or a name -> path map (several binaries).
interface TypescriptPackageJson { bin?: string | Record<string, string> | undefined }

// Resolve the installed `typescript` package's own `tsc` entry point (its package.json `bin` field)
// rather than hard-coding `node_modules/typescript/bin/tsc` or shelling out to `npx`/a PATH lookup —
// `import.meta.resolve` uses Node's real ESM resolver (respects `typescript`'s `exports` map, works
// whether the package is hoisted to the repo root or nested), and doesn't depend on a network call
// or a globally-installed tsc the way `npx` would.
function resolveTscEntry(): string | null {
  let pkgUrl;
  try {
    pkgUrl = import.meta.resolve("typescript/package.json");
  } catch {
    return null; // the `typescript` devDependency isn't installed — see the packaged-app fallback in buildUi()
  }
  const pkgPath = fileURLToPath(pkgUrl);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as TypescriptPackageJson;
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsc;
  if (!bin) return null;
  return join(dirname(pkgPath), bin);
}

// A compile takes well under a second; this only exists so a child that never exits fails the
// build with ETIMEDOUT instead of blocking its caller forever.
const TSC_TIMEOUT_MS = 120_000;

// electron/main.mts calls buildUi() from Electron's main process, where process.execPath is the
// Electron binary rather than node — spawned as-is it would start a second Electron app with the
// tsc launcher as its main script, which on Windows never returns. ELECTRON_RUN_AS_NODE makes that
// binary behave as plain Node for this one child; under real Node it is left unset.
export function tscSpawnEnv(
  versions: NodeJS.ProcessVersions = process.versions, env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return versions.electron ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env;
}

export function buildUi({ tsconfig = TSCONFIG }: { tsconfig?: string } = {}): string {
  const tscEntry = resolveTscEntry();
  if (!tscEntry || !existsSync(tscEntry)) {
    // The packaged Electron app ships no devDependencies (electron-builder's `files` list excludes
    // them) — it carries a pre-built app/dist/ instead. Only tolerate a missing compiler when
    // there's already a built page to fall back to; otherwise this must fail loudly rather than
    // serve a stale or absent page with no explanation.
    // Say so when it happens (the packaged app never calls buildUi() at all — electron/server-entry.mts
    // does no building — so this is always a source checkout): it means the page
    // being served is whatever was last built, not the sources on disk (`npm ci --omit=dev` followed
    // by a branch switch is the way to get here), and that must not pass silently.
    if (existsSync(UI_ENTRY_OUT)) {
      console.warn("build-ui: no TypeScript compiler installed — serving the existing app/dist/ as-is, which may be stale. Run `npm install` to rebuild the page from source.");
      return UI_ENTRY_OUT;
    }
    throw new Error("the TypeScript compiler isn't installed (no `typescript` package found) and app/dist/ui/app.mjs doesn't exist yet — run `npm install`");
  }
  rmSync(join(ROOT, "app", "dist"), { recursive: true, force: true });
  // TypeScript 7 is the native compiler: bin/tsc is a small JS launcher that finds and runs a
  // platform-specific binary from one of typescript's optionalDependencies. Spawning the launcher
  // under process.execPath keeps this free of any PATH or shebang dependency; if the native binary
  // is missing (`npm ci --omit=optional`, an unlisted platform) the launcher exits non-zero and the
  // throw below surfaces its message rather than serving a stale page.
  const result = spawnSync(process.execPath, [tscEntry, "-p", tsconfig], {
    cwd: ROOT, encoding: "utf8", env: tscSpawnEnv(), timeout: TSC_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`tsc -p ${relative(ROOT, tsconfig)} failed (exit ${result.status}):\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return UI_ENTRY_OUT;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(buildUi());
