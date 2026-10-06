// gen-contracts.test.mts — the generator that copies adapters/_shared/ fragments into the adapter scripts.
// Tags are name prefixes: [smoke] [fast] [slow]. Run: node --test scripts/gen-contracts.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, splice, fragmentProblems } from "./gen-contracts.mts";

test("[smoke] gen-contracts: every adapter script's generated blocks match adapters/_shared, and every fragment is used", () => {
  const { stale, unused } = generate();
  assert.deepEqual(stale, [], "run node scripts/gen-contracts.mts and commit the result");
  assert.deepEqual(unused, []);
});

const frags: Record<string, string> = { helper: "def helper():\n    return 1\n", "tazuo/only": "X = 1\n" };
const get = (n: string) => frags[n] ?? null;

test("[fast] gen-contracts: rewrites only the lines between a block's markers", () => {
  const src = "import os\n# BEGIN generated: helper\ndef helper():\n    return 0\n# END generated: helper\n\n\ndef main():\n    pass\n";
  const { text, used } = splice(src, get, "tazuo");
  assert.equal(text, src.replace("return 0", "return 1"));
  assert.deepEqual(used, ["helper"]);
  assert.equal(splice(text, get, "tazuo").text, text, "a second run changes nothing");
});

test("[fast] gen-contracts: refuses an unmatched marker, a missing fragment and another adapter's fragment", () => {
  assert.throws(() => splice("# BEGIN generated: helper\nx\n", get, "tazuo"), /no matching END/);
  assert.throws(() => splice("# BEGIN generated: helper\n# END generated: other\n", get, "tazuo"), /no matching END/);
  assert.throws(() => splice("# BEGIN generated: helper\n# BEGIN generated: helper\n# END generated: helper\n", get, "tazuo"), /no matching END/);
  assert.throws(() => splice("x\n# END generated: helper\n", get, "tazuo"), /END marker with no BEGIN/);
  assert.throws(() => splice("# BEGIN generated: nope\n# END generated: nope\n", get, "tazuo"), /no fragment/);
  assert.throws(() => splice("# BEGIN generated: tazuo/only\n# END generated: tazuo/only\n", get, "razor-enhanced"), /belongs to tazuo/);
});

test("[fast] gen-contracts: a fragment a Razor Enhanced script carries stays ASCII with no f-strings", () => {
  assert.deepEqual(fragmentProblems("helper", 'x = "{}".format(1)  # f"in a comment" is fine\n', "razor-enhanced"), []);
  assert.match(fragmentProblems("helper", 'x = f"{y}"\n', "razor-enhanced").join(), /f-string/);
  assert.match(fragmentProblems("helper", "x = rf'{y}'\n", "razor-enhanced").join(), /f-string/);
  assert.match(fragmentProblems("helper", 'x = "café"\n', "razor-enhanced").join(), /not ASCII/);
  assert.deepEqual(fragmentProblems("helper", 'x = f"{y}"\n', "tazuo"), [], "TazUO runs CPython");
  assert.match(fragmentProblems("helper", "x = 1", "tazuo").join(), /exactly one newline/);
});

test("[fast] gen-contracts: generate() finds a stale script and an unused fragment", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-contracts-"));
  try {
    mkdirSync(join(root, "_shared", "tazuo"), { recursive: true });
    mkdirSync(join(root, "tazuo"));
    writeFileSync(join(root, "_shared", "helper.py"), frags.helper!);
    writeFileSync(join(root, "_shared", "tazuo", "spare.py"), "Y = 2\n");
    const script = join(root, "tazuo", "packrat-x.py");
    writeFileSync(script, "# BEGIN generated: helper\nold\n# END generated: helper\n");
    writeFileSync(join(root, "tazuo", "test_x.py"), "# BEGIN generated: missing\n");
    const { files, stale, unused } = generate(root);
    assert.deepEqual(stale, [script], "only packrat-*.py scripts are read");
    assert.deepEqual(unused, ["tazuo/spare"]);
    assert.equal(files.get(script), "# BEGIN generated: helper\n" + frags.helper + "# END generated: helper\n");
    assert.equal(readFileSync(script, "utf8").includes("old"), true, "generate() writes nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[fast] gen-contracts: a CRLF checkout of a script and its fragment is up to date, and a rewrite keeps CRLF", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-contracts-"));
  try {
    mkdirSync(join(root, "_shared"), { recursive: true });
    mkdirSync(join(root, "tazuo"));
    writeFileSync(join(root, "_shared", "helper.py"), frags.helper!.replace(/\n/g, "\r\n"));
    const current = join(root, "tazuo", "packrat-a.py"), old = join(root, "tazuo", "packrat-b.py");
    const block = (body: string) => ("import os\n# BEGIN generated: helper\n" + body + "# END generated: helper\n").replace(/\n/g, "\r\n");
    writeFileSync(current, block(frags.helper!));
    writeFileSync(old, block("old\n"));
    const { files, stale } = generate(root);
    assert.deepEqual(stale, [old]);
    assert.equal(files.get(old), block(frags.helper!));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
