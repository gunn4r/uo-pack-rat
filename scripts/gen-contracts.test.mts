// gen-contracts.test.mts — `scripts/gen-contracts.mts`, the generator that copies `adapters/_shared/` fragments into the adapter scripts.
//
// `scripts/gen-contracts.mts`: every adapter script's generated blocks match their `adapters/_shared/` fragments and every fragment is carried by some script (`[smoke]`, the same check as `--check`); a block's inner lines rewritten and nothing else, a second run changing nothing; an unmatched or nested marker, a missing fragment and another adapter's fragment refused; a fragment a Razor Enhanced script carries refused when it is not ASCII or uses an f-string; and `generate()` naming a stale script and an unused fragment while writing nothing; the `manifest` blocks rendered from an adapter's `capabilities.json`, and a version bump there making every script that carries one stale. The rest `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, splice, fragmentProblems, renderManifest } from "./gen-contracts.mts";

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

test("[fast] gen-contracts: the manifest blocks are Python literals of capabilities.json, lists wrapped, the values between them on one line", () => {
  const doc = { adapter: "tazuo", version: "2.20.0", capabilities: { layers: Array.from({ length: 12 }, (_, i) => `Layer${i}`), arms: true, bank: false, tooltips: "opl", none: null, bridge: [] } };
  assert.equal(renderManifest("manifest", doc), [
    'ADAPTER_ID = "tazuo"',
    'ADAPTER_VERSION = "2.20.0"',
    "CAPABILITIES = {",
    '    "layers": ["Layer0", "Layer1", "Layer2", "Layer3", "Layer4", "Layer5", "Layer6", "Layer7",',
    '               "Layer8", "Layer9", "Layer10", "Layer11"],',
    '    "arms": True, "bank": False, "tooltips": "opl", "none": None,',
    '    "bridge": [],',
    "}",
    "",
  ].join("\n"));
  assert.equal(renderManifest("manifest_version", doc), 'ADAPTER_ID = "tazuo"\nADAPTER_VERSION = "2.20.0"\n');
  assert.throws(() => renderManifest("manifest", { ...doc, version: "2.20.0-é" }), /printable ASCII/);
  assert.throws(() => renderManifest("manifest", { ...doc, capabilities: { install: { a: 1 } } }), /must be a list/);
});

test("[fast] gen-contracts: a version bump in capabilities.json makes every script carrying a manifest block stale", () => {
  const root = mkdtempSync(join(tmpdir(), "gen-contracts-"));
  try {
    mkdirSync(join(root, "_shared"), { recursive: true });
    mkdirSync(join(root, "tazuo"));
    const manifest = (version: string): string => JSON.stringify({ adapter: "tazuo", version, capabilities: { bridge: ["scan"] } });
    writeFileSync(join(root, "tazuo", "capabilities.json"), manifest("1.0.0"));
    const scanner = join(root, "tazuo", "packrat-scanner.py"), panel = join(root, "tazuo", "packrat-panel.py");
    writeFileSync(scanner, "# BEGIN generated: manifest\n# END generated: manifest\n");
    writeFileSync(panel, "# BEGIN generated: manifest_version\n# END generated: manifest_version\n");
    for (const [p, t] of generate(root).files) writeFileSync(p, t);
    assert.deepEqual(generate(root).stale, [], "up to date once written");
    writeFileSync(join(root, "tazuo", "capabilities.json"), manifest("1.0.1"));
    const { files, stale } = generate(root);
    assert.deepEqual(stale.sort(), [panel, scanner].sort());
    assert.match(files.get(scanner)!, /^ADAPTER_VERSION = "1\.0\.1"$/m);
    assert.match(files.get(panel)!, /^ADAPTER_VERSION = "1\.0\.1"$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
