// layering.test.mts — [smoke]: the import layering of app/, scripts/ and electron/, read from the static
// `import … from`, `export … from` and `import()` specifiers of every non-test .mts in the tree, untracked ones included (comment lines skipped):
//   1. nothing outside app/ui/ imports from app/ui/ (tests excluded);
//   2. the browser-shared modules (tsconfig.browser.json's include, minus app/ui/**) reach no node: module;
//   3. the modules outside app/ui/ have no import cycles (app/ui/ has some today; stage 4 extends this rule to it);
//   4. every module app/ui/ reaches outside app/ui/ has its own "/<path>.mjs" route in app/vault-server.mts (the page
//      gets a 404 at load otherwise; build:ui compiles it whether or not the include lists it) and reaches no node: module.
// Rules 2-4 follow runtime imports only: `import type` and `export type` are erased, so they load nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { posix } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "app", "scripts", "electron"], { cwd: root, encoding: "utf8" }).split("\n");
const modules = tracked.filter((f) => f.endsWith(".mts") && !f.endsWith(".test.mts") && !f.endsWith(".d.mts") && existsSync(posix.join(root, f)));
const isUi = (f: string): boolean => f.startsWith("app/ui/");

type Edge = { spec: string; to: string | null; typeOnly: boolean };
const STATIC = /^\s*(import|export)(\s+type\b)?(?:[^;'"`]*?\bfrom)?\s*["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
function edgesOf(file: string): Edge[] {
  const text = readFileSync(posix.join(root, file), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\/\*[\s\S]*?\*\//gm, "");
  const resolve = (spec: string): string | null => spec.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), spec)) : null;
  return [
    ...[...text.matchAll(STATIC)].map((m) => ({ spec: m[3]!, to: resolve(m[3]!), typeOnly: !!m[2] })),
    ...[...text.matchAll(DYNAMIC)].map((m) => ({ spec: m[1]!, to: resolve(m[1]!), typeOnly: false })),
  ];
}
const edges = new Map(modules.map((f) => [f, edgesOf(f)]));
const runtime = (f: string): Edge[] => (edges.get(f) ?? []).filter((e) => !e.typeOnly);

// tsconfig.browser.json's include, as tracked modules ("app/vault-lib.*" style globs).
const browserTsconfig = JSON.parse(readFileSync(posix.join(root, "tsconfig.browser.json"), "utf8")) as { include: string[] };
const globRe = (g: string): RegExp => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);
const includeRes = browserTsconfig.include.map(globRe);
const browserIncluded = (f: string): boolean => includeRes.some((re) => re.test(f));
const browserShared = modules.filter((f) => browserIncluded(f) && !isUi(f));

// Every module reachable from `start` through runtime imports, with the path that first reached it.
function reach(start: string, through: (f: string) => boolean = () => true): Map<string, string[]> {
  const seen = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
    for (const e of runtime(f)) {
      const to = e.to ?? e.spec;
      if (seen.has(to)) continue;
      seen.set(to, [...seen.get(f)!, to]);
      if (e.to && edges.has(e.to) && through(e.to)) queue.push(e.to);
    }
  }
  return seen;
}

test("[smoke] layering: the parser finds the imports the modules are known to have", () => {
  assert.ok(modules.length > 50 && browserShared.length > 3, `${modules.length} modules, ${browserShared.length} browser-shared`);
  assert.ok(runtime("app/vault-server.mts").some((e) => e.spec === "node:http"), "vault-server imports node:http");
  assert.ok((edges.get("app/ui/api-types.mts") ?? []).some((e) => e.typeOnly && e.to === "app/vault-lib.mts"), "ui/api-types imports types from vault-lib");
  assert.ok(runtime("app/ui/import.mts").some((e) => e.to === "app/paste-scan.mts"), "ui/import imports paste-scan");
});

test("[smoke] layering: nothing outside app/ui/ imports from app/ui/", () => {
  const found = modules.filter((f) => !isUi(f)).flatMap((f) => edges.get(f)!.filter((e) => e.to && isUi(e.to)).map((e) => `${f} → ${e.spec}`));
  assert.deepEqual(found, []);
});

test("[smoke] layering: the browser-shared modules reach no node: module", () => {
  const found = browserShared.flatMap((f) => [...reach(f)].filter(([to]) => to.startsWith("node:")).map(([, path]) => path.join(" → ")));
  assert.deepEqual(found, []);
});

test("[smoke] layering: no import cycles outside app/ui/", () => {
  const found = new Set<string>();
  for (const f of modules.filter((m) => !isUi(m))) {
    for (const e of runtime(f)) {
      if (!e.to || isUi(e.to)) continue;
      const back = reach(e.to, (m) => !isUi(m)).get(f);
      if (back) found.add([f, ...back].join(" → "));
    }
  }
  assert.deepEqual([...found], []);
});

// The static routes app/vault-server.mts serves a shared module on, read from its `url.pathname === "/x.mjs"` checks.
const routes = new Set([...readFileSync(posix.join(root, "app/vault-server.mts"), "utf8").matchAll(/url\.pathname === "(\/[^"]+\.mjs)"/g)].map((m) => m[1]!));
const routeOf = (f: string): string => `/${f.slice("app/".length).replace(/\.mts$/, ".mjs")}`;

test("[smoke] layering: every module app/ui/ reaches outside app/ui/ has its static route and reaches no node: module", () => {
  assert.ok(routes.has("/vault-lib.mjs") && routes.has("/schema/validate.mjs"), `routes read: ${[...routes].join(", ")}`);
  const found = new Map<string, string>();
  for (const f of modules.filter(isUi)) {
    for (const [to, path] of reach(f)) {
      if (isUi(to) || found.has(to)) continue;
      if (!to.startsWith("app/")) found.set(to, `${path.join(" → ")}: not a module the page can load`);
      else if (!routes.has(routeOf(to))) found.set(to, `${path.join(" → ")}: no ${routeOf(to)} route in app/vault-server.mts`);
    }
  }
  assert.deepEqual([...found.values()], []);
});
