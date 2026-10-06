// docs-links.test.mts — a [smoke] guard that every repo path the Markdown names in backticks exists.
//
// Every tracked Markdown file (untracked ones included, CHANGELOG.md left out: it is a history and names files that were since renamed or retired) is read for backticked spans that are repo paths: a plain relative path whose first segment is a top-level entry of the tree (`app/x.mts`, `docs/`, `README.md`). Placeholders (`<data>/...`), globs, URLs and paths relative to somewhere else (`ui/x.mts`) are not repo paths, so they are not checked. A path that does not exist passes only when git ignores it (a build output such as `app/dist/`) or when `ALLOWED` names it with its reason; add to `ALLOWED` only for an intentional example, never for a path that moved: fix the doc instead.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Paths that are named on purpose and do not exist, with the reason.
const ALLOWED: Record<string, string> = {
  "adapters/outlands/": "docs/adapter-guide.md names the adapter folder a shard's rules forbid, which must never exist",
  "app/shared-search.mjs": "app/bench/README.md tells the history of a module retired in Phase 3",
};

const PATH = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\/?$/;

// The repo paths named in backticks in `text`, given the tree's top-level entries.
export function namedRepoPaths(text: string, top: Set<string>): string[] {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
  return [...new Set(spans.filter((s) => PATH.test(s) && (s.includes("/") ? top.has(s.split("/")[0]!) : top.has(s))))];
}

// Listed inside the tests, not at load: outside a git checkout (a source archive) git fails.
function tree(): string[] | null {
  try { return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); } catch { return null; }
}

function ignored(paths: string[]): Set<string> {
  if (!paths.length) return new Set();
  try { return new Set(execFileSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: root, encoding: "utf8", input: paths.join("\n") }).split("\n").filter(Boolean)); }
  catch { return new Set(); } // exit 1: none of them is ignored
}

function scan(files: string[]): { named: number; gone: string[] } {
  const top = new Set(files.map((f) => f.split("/")[0]!));
  let named = 0;
  const missing: [string, string][] = [];
  for (const md of files.filter((f) => f.endsWith(".md") && f !== "CHANGELOG.md" && existsSync(join(root, f)))) {
    for (const p of namedRepoPaths(readFileSync(join(root, md), "utf8"), top)) {
      named++;
      if (!existsSync(join(root, p)) && !(p in ALLOWED)) missing.push([md, p]);
    }
  }
  const skip = ignored([...new Set(missing.map(([, p]) => p))]);
  return { named, gone: missing.filter(([, p]) => !skip.has(p)).map(([md, p]) => `${md}: ${p}`) };
}

test("[smoke] every repo path the Markdown names in backticks exists", (t) => {
  const files = tree();
  if (!files) return t.skip("not a git checkout");
  const { gone } = scan(files);
  assert.deepEqual(gone, [], `these docs name paths that do not exist (fix the doc, or see ALLOWED):\n${gone.join("\n")}`);
});

// A guard that silently sees nothing proves nothing.
test("[smoke] the docs-link guard sees the docs' paths", (t) => {
  const files = tree();
  if (!files) return t.skip("not a git checkout");
  assert.ok(scan(files).named >= 500, "expected hundreds of repo paths across the docs");
});

test("[fast] namedRepoPaths takes plain paths under a top-level entry and leaves the rest", () => {
  const top = new Set(["app", "docs", "README.md"]);
  const text = "See `app/x.mts`, `docs/`, `README.md`, `app/x.mts` again, `<data>/scans/`, `ui/x.mts`, `node:test`, `app/*.mts`, `settings.json`, `a b/c` and `https://x.y/z`.";
  assert.deepEqual(namedRepoPaths(text, top), ["app/x.mts", "docs/", "README.md"]);
});
