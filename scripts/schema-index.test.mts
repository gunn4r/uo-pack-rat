// schema-index.test.mts — a [fast] guard that app/schema/README.md's contract index lists every schema file in app/schema/, and nothing else.
//
// The index table's first column names each `app/schema/*.schema.json` once; a new schema gets its row (the file, its writers, readers and shared cases) when it is added, and a removed one loses it.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "schema");

test("[fast] schema index: app/schema/README.md has one row per schema file in app/schema/", () => {
  const rows = [...readFileSync(join(dir, "README.md"), "utf8").matchAll(/^\| `([^`]+\.schema\.json)` \|/gm)].map((m) => m[1]!);
  const files = readdirSync(dir).filter((f) => f.endsWith(".schema.json"));
  assert.deepEqual([...rows].sort(), files.sort());
});
