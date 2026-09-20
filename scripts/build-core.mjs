#!/usr/bin/env node
// build-core.mjs — compile scripts/optimizer-core.mts (a real ES module) into app/dist/optimizer-core.mjs
// by stripping types with node:module. Idempotent: rewrites only when the source is newer.
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CORE_SRC = join(ROOT, "scripts", "optimizer-core.mts");
export const CORE_OUT = join(ROOT, "app", "dist", "optimizer-core.mjs");

const SELF = fileURLToPath(import.meta.url);

export function buildCore({ src = CORE_SRC, out = CORE_OUT } = {}) {
  // Rebuild when the output is older than the source OR older than this builder itself, so editing
  // build-core.mjs (a type-stripping option, the generated-file header, …) doesn't leave a stale
  // app/dist/optimizer-core.mjs that silently keeps its previous shape.
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs && statSync(out).mtimeMs >= statSync(SELF).mtimeMs) return out;
  const js = stripTypeScriptTypes(readFileSync(src, "utf8"), { mode: "strip" });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `// generated from ${src.slice(ROOT.length + 1)} by scripts/build-core.mjs — do not edit\n` + js);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(buildCore());
