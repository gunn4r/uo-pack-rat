// module-map.test.mts — a [smoke] guard that keeps `docs/module-map.md` from falling behind the tree.
//
// Every tracked non-test `.mts` file under `app/`, `scripts/` and `electron/` (fixtures included) carries its row in its header, and the map's generated tables must be what `node scripts/module-index.mts --check` expects; every repo path the map names in backticks must exist. A failure names the fix: the header line to add, or `npm run gen:modules`. Runs over `git ls-files`, and a guard test fails if it sees no modules or no named paths. Also unit cases of `headerOf` and `withTables`.
//
// app/dist/ is excluded, and untracked files count too, so a new module counts before it is added. Each route module under `app/http/routes/` also lists every path it registers in its header.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generated, headerOf, moduleFiles, withTables } from "./module-index.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = "docs/module-map.md";

// Outside a git checkout (a source archive) git fails, so the tree tests skip there.
function inGit(): boolean {
  try { execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "ignore" }); return true; } catch { return false; }
}

// A backticked span is a repo path when it is a plain relative path with a directory or a file extension: no
// spaces, no placeholders (`<data>/…`), no globs, no URLs or Node specifiers (`node:test`).
const PATH = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\/?$/;
function namedPaths(text: string): string[] {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
  return [...new Set(spans.filter((s) => PATH.test(s) && (s.includes("/") || /[A-Za-z0-9_-]\.[a-z]{2,4}$/.test(s))))];
}

test("[smoke] every module's header gives its row in docs/module-map.md", (t) => {
  if (!inGit()) return t.skip("not a git checkout");
  const { problems } = generated(root);
  assert.deepEqual(problems, [], `fix these headers, then run npm run gen:modules:\n${problems.join("\n")}`);
});

test("[smoke] docs/module-map.md's module tables are current", (t) => {
  if (!inGit()) return t.skip("not a git checkout");
  const { current, next } = generated(root);
  assert.ok(next === current, "run npm run gen:modules");
});

test("[smoke] every repo path docs/module-map.md names exists", () => {
  const paths = namedPaths(readFileSync(join(root, MAP), "utf8"));
  const gone = paths.filter((p) => !existsSync(join(root, p)));
  assert.deepEqual(gone, [], `${MAP} names paths that do not exist:\n${gone.join("\n")}`);
});

// A guard that silently sees nothing proves nothing.
test("[smoke] the module map guard sees the tree and the map's paths", (t) => {
  if (!inGit()) return t.skip("not a git checkout");
  const modules = moduleFiles(root);
  assert.ok(modules.length >= 100, `expected the app's modules, got ${modules.length}`);
  const named = new Set(namedPaths(readFileSync(join(root, MAP), "utf8")));
  assert.deepEqual(modules.filter((f) => !named.has(f)), [], "every module has a row");
});

test("[fast] headerOf reads the role's first sentence, the area and the owned names", () => {
  assert.deepEqual(headerOf("app/x.mts", "// x.mts — the parser (issue #1). More here.\n//\n// map: scan\n// owns: `parse`\nimport y;"), { role: "The parser (issue #1).", area: "scan", owns: "`parse`" });
  assert.deepEqual(headerOf("app/ui/x.mts", "#!/usr/bin/env node\r\n// ui/x.mts — a temp-then-\r\n// rename. Done.\r\n// map: ui-data\r\n"), { role: "A temp-then-rename.", area: "ui-data", owns: "—" });
  assert.deepEqual(headerOf("scripts/x.mts", "// ====\n// x.mts — readBody, kept as is.\n// map: tooling\n"), { role: "readBody, kept as is.", area: "tooling", owns: "—" });
  assert.match(headerOf("app/x.mts", "// y.mts — another file.\n// map: scan\n") as string, /needs a line "\/\/ x\.mts — <role>\."/);
  assert.match(headerOf("app/x.mts", "// x.mts — no full stop\n// map: scan\n") as string, /full stop/);
  assert.match(headerOf("app/x.mts", "// x.mts — the parser.\nimport y;\n// map: scan\n") as string, /needs a line "\/\/ map: <area>"/);
});

test("[fast] withTables replaces only what lies between the markers, whatever the line endings", () => {
  const doc = "# M\r\n\r\n<!-- module-map:start a -->\r\nold\r\n<!-- module-map:end -->\r\n\r\nprose\r\n<!-- module-map:start b -->\r\n<!-- module-map:end -->\r\n";
  const out = withTables(doc, new Map([["a", "| Module | Role | Owns |\n|---|---|---|\n| `x` | X. | — |"]]));
  assert.equal(out, "# M\n\n<!-- module-map:start a -->\n| Module | Role | Owns |\n|---|---|---|\n| `x` | X. | — |\n<!-- module-map:end -->\n\nprose\n<!-- module-map:start b -->\n| Module | Role | Owns |\n|---|---|---|\n<!-- module-map:end -->\n");
});

// A route module's header is where its routes are written down (docs/architecture.md, HTTP routes), so a registered path missing from it is a route nobody documented.
test("[fast] every route module's header lists each path it registers", () => {
  const dir = join(root, "app/http/routes");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mts") && !f.endsWith(".test.mts"));
  assert.ok(files.length >= 10, `expected the route modules in ${dir}`);
  const missing: string[] = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    const header = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n");
    for (const [, path] of text.matchAll(/\bpath: "([^"]+)"/g)) {
      const esc = path!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(?<![\\w.-])${esc}(?![\\w/.-])`).test(header)) missing.push(`app/http/routes/${f}: ${path}`);
    }
  }
  assert.deepEqual(missing, [], "add each route to its module's header, beside the others");
});
