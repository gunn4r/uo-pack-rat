// test-tags.test.mts — a [smoke] guard that every top-level test name starts with a tag.
//
// a `[smoke]` guard that every top-level test in a tracked `*.test.mts` starts its name with a tag (`[smoke]`, `[fast]` or `[slow]`), read from the string-literal first argument of `test(…)`; subtests inherit their parent's tag and are not checked.
//
// The runner picks tests by name pattern, so an untagged test silently runs only in full mode. Names are also read from it(…) where a file imports it from node:test; a template literal that opens with an expression can't be checked statically and is skipped.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CALL = /(?<![\w.$])(test|it)(?:\.(?:skip|only|todo))?\(\s*(["'`])([^\n]{0,8})/g;
const TAG = /^\[(smoke|fast|slow)\]/;

function untagged(text: string): string[] {
  const itIsTest = /import\s*\{[^}]*\bit\b[^}]*\}\s*from\s*"node:test"/.test(text);
  const out: string[] = [];
  for (const [call, fn, quote, head] of text.matchAll(CALL)) {
    if (fn === "it" && !itIsTest) continue;
    if (quote === "`" && head!.startsWith("${")) continue;
    if (!TAG.test(head!)) out.push(call);
  }
  return out;
}

test("[smoke] the tag check flags an untagged name and passes tagged ones", () => {
  // The untagged call is spelled test\u0028 (here and in the expected value) so this file's own scan below does not flag it.
  const src = 'import { test } from "node:test";\ntest("[fast] a", () => {});\ntest(`[slow] b ${1}`, () => {});\ntest\u0028"c", () => {});\nt.test("d", () => {});\nconst it = (s) => s; it("e");\n';
  assert.deepEqual(untagged(src), ['test\u0028"c", () =']);
});

test("[smoke] every test in a tracked *.test.mts starts its name with a tag", () => {
  const files = execFileSync("git", ["ls-files", "*.test.mts"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const found = files.flatMap((f) => untagged(readFileSync(join(root, f), "utf8")).map((call) => `${f}: ${call}`));
  assert.deepEqual(found, [], `untagged tests:\n${found.join("\n")}`);
});
