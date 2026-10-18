// compat-shims.test.mts — a [fast] guard that docs/architecture.md's "Compatibility shims" table and the code's `compat: <id>` comments name the same shims.
//
// Every row of the table names an id that some tracked file under app/ or adapters/ cites as `compat: <id>`, and every id the code cites has a row, so a shim can't lose its removal release, and a deleted shim's row goes with it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("[fast] compat shims: every shim the code cites has a row in docs/architecture.md, and every row is cited", () => {
  const doc = readFileSync(join(root, "docs", "architecture.md"), "utf8");
  const section = doc.slice(doc.indexOf("## Compatibility shims"), doc.indexOf("\n## ", doc.indexOf("## Compatibility shims") + 1));
  const rows = new Set([...section.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]!));
  const files = execFileSync("git", ["ls-files", "app", "adapters"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => /\.(mts|py|json)$/.test(f));
  const cited = new Set(files.flatMap((f) => [...readFileSync(join(root, f), "utf8").matchAll(/compat: ([a-z0-9-]+)/g)].map((m) => m[1]!)));
  assert.ok(rows.size > 0, "the table has rows");
  assert.deepEqual([...cited].sort(), [...rows].sort());
});
