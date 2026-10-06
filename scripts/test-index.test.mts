// test-index.test.mts — a [smoke] guard that every test file describes itself in a header and that TESTING.md's test index is current.
//
// Every `*.test.mts` and adapter `test_*.py` must open with its header (`// <name> — <summary>.`, or `"""<name> -- <summary>.` in Python), and the index between TESTING.md's markers must be what `node scripts/test-index.mts --check` expects. A failure names the fix: add the header, or run `node scripts/test-index.mts --write`. Also unit cases of `summaryOf`, the first-sentence rule.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { END, START, indexIsCurrent, renderIndex, summaryOf, testFiles, withIndex } from "./test-index.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Outside a git checkout (a source archive) git fails, so the tree tests skip there.
function inGit(): boolean {
  try { execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "ignore" }); return true; } catch { return false; }
}

test("[smoke] every test file has a header whose first sentence the index can show", (t) => {
  if (!inGit()) return t.skip("not a git checkout");
  const { missing } = renderIndex(root);
  assert.deepEqual(missing, [], `give these a header, first line "// <name> — <summary>." ("""<name> -- <summary>." in Python):\n${missing.join("\n")}`);
});

test("[smoke] TESTING.md's test index is current", (t) => {
  if (!inGit()) return t.skip("not a git checkout");
  assert.ok(indexIsCurrent(root), "run node scripts/test-index.mts --write");
});

// A guard that silently sees nothing proves nothing.
test("[smoke] the test index sees the test files, Python ones included", (t) => {
  if (!inGit()) return t.skip("not a git checkout");
  const files = testFiles(root);
  assert.ok(files.length >= 100, `expected the suite's test files, got ${files.length}`);
  assert.ok(files.includes("scripts/test-index.test.mts"));
  assert.ok(files.includes("adapters/test_bridges.py"));
});

test("[fast] summaryOf takes the header's first sentence, and only from a header naming its own file", () => {
  assert.equal(summaryOf("app/x.test.mts", "// x.test.mts — `app/x.mts`'s parser. More detail here.\nimport x;"), "`app/x.mts`'s parser.");
  assert.equal(summaryOf("app/x.test.mts", "// x.test.mts — version 1.0 of the 2.3 rules (issue #12).\r\n"), "version 1.0 of the 2.3 rules (issue #12).");
  assert.equal(summaryOf("adapters/test_y.py", '"""test_y.py -- the bridge loop. Detail.\n"""'), "the bridge loop.");
  assert.equal(summaryOf("adapters/test_y.py", '"""test_y.py — the bridge loop.\n"""'), "the bridge loop.");
  assert.equal(summaryOf("app/x.test.mts", "// y.test.mts — another file's header.\n"), null);
  assert.equal(summaryOf("app/x.test.mts", "// x.test.mts — no full stop\n"), null);
  assert.equal(summaryOf("app/x.test.mts", "import { test } from \"node:test\";\n"), null);
  assert.equal(summaryOf("app/x.test.mts", "// x.test.mts - a hyphen, not the dash.\n"), null);
});

test("[fast] withIndex replaces only what lies between the markers, whatever the line endings", () => {
  const doc = `# T\r\n\r\n${START}\r\nold\r\n${END}\r\n\r\n## After\r\n`;
  assert.equal(withIndex(doc, "- new"), `# T\n\n${START}\n- new\n${END}\n\n## After\n`);
  assert.throws(() => withIndex("# no markers\n", "- new"), /no index markers/);
});
