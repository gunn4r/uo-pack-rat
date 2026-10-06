// module-map.test.mts — [smoke]: keeps docs/module-map.md from falling behind the tree. Every tracked non-test .mts
// file under app/, scripts/ and electron/ (fixtures included, app/dist/ excluded) must be named in the map, and every
// repo path the map names in backticks must exist. Reads the tree with `git ls-files` (untracked files included, so a new module counts before it is added).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = "docs/module-map.md";

// Listed inside the tests, not at load: outside a git checkout (a source archive) git fails.
function trackedModules(): string[] | null {
  let out: string;
  try { out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "app", "scripts", "electron"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
  return out.split("\n").filter((f) => f.endsWith(".mts") && !f.endsWith(".test.mts") && !f.startsWith("app/dist/") && existsSync(join(root, f)));
}

// A backticked span is a repo path when it is a plain relative path with a directory or a file extension: no
// spaces, no placeholders (`<data>/…`), no globs, no URLs or Node specifiers (`node:test`).
const PATH = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\/?$/;
function namedPaths(text: string): string[] {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
  return [...new Set(spans.filter((s) => PATH.test(s) && (s.includes("/") || /[A-Za-z0-9_-]\.[a-z]{2,4}$/.test(s))))];
}

test("[smoke] every tracked non-test .mts module is named in docs/module-map.md", (t) => {
  const modules = trackedModules();
  if (!modules) return t.skip("not a git checkout");
  const named = new Set(namedPaths(readFileSync(join(root, MAP), "utf8")));
  const missing = modules.filter((f) => !named.has(f));
  assert.deepEqual(missing, [], `add these to ${MAP}:\n${missing.join("\n")}`);
});

test("[smoke] every repo path docs/module-map.md names exists", () => {
  const paths = namedPaths(readFileSync(join(root, MAP), "utf8"));
  const gone = paths.filter((p) => !existsSync(join(root, p)));
  assert.deepEqual(gone, [], `${MAP} names paths that do not exist:\n${gone.join("\n")}`);
});

// A guard that silently sees nothing proves nothing.
test("[smoke] the module map guard sees the tree and the map's paths", (t) => {
  const modules = trackedModules();
  if (!modules) return t.skip("not a git checkout");
  assert.ok(modules.length >= 100, `expected the app's modules, got ${modules.length}`);
  assert.ok(namedPaths(readFileSync(join(root, MAP), "utf8")).length >= 100);
});
