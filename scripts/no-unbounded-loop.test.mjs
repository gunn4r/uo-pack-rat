// no-unbounded-loop.test.mjs — [smoke]: standing guard for the project rule (CLAUDE.md's Global
// Constraints, both the plan that added the Razor Enhanced/classicuo-web adapters and every adapter
// script's own header) that no adapter `.py` file may contain a literal `while True`, `while (true)`,
// or `while(true)` anywhere — comments and strings included, not just live code. TazUO itself refuses
// to run a Legion script whose text contains any of these three forms as a plain substring match (see
// adapters/tazuo/README.md and the project's own CLAUDE.md for the live incident that rule guards
// against: a script got flagged for a COMMENT that said "no while True"). This had no test behind it
// until now — every adapter script instead relied on a human remembering to grep before deploying.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The exact three forms the rule bans, as plain substrings — matching TazUO's own check (a substring
// match, not a regex with whitespace tolerance) rather than a broader pattern like `while\s*\(?\s*1\b`
// that would also flag `while 1` (not on the banned list, per CLAUDE.md's own note, though still
// worth avoiding by convention) and risk false positives inside unrelated prose.
const BANNED_FORMS = ["while True", "while (true)", "while(true)"];

function adapterPyFiles() {
  return execFileSync("git", ["ls-files", "adapters"], { cwd: root, encoding: "utf8" })
    .split("\n").filter((f) => f.endsWith(".py"));
}

test("[smoke] no adapter .py file contains the banned unbounded-loop literal, in any form, anywhere", () => {
  const files = adapterPyFiles();
  const found = [];
  for (const file of files) {
    const body = readFileSync(join(root, file), "utf8");
    for (const form of BANNED_FORMS) {
      if (body.includes(form)) found.push(`${file}: contains literal "${form}"`);
    }
  }
  assert.deepEqual(found, [], `banned unbounded-loop literal found:\n${found.join("\n")}`);
});

// A guard that silently sees zero files proves nothing — this is app/scan-schema.test.mjs's own
// "the guard actually sees tracked files" idiom, applied here to just the adapters/ subtree.
test("[smoke] the guard actually sees adapter .py files", () => {
  const files = adapterPyFiles();
  assert.ok(files.length >= 4, `expected at least the tazuo (3 scripts) + razor-enhanced (2 scripts) adapters' .py files, got ${JSON.stringify(files)}`);
});
