// json-file.test.mts — `app/store/json-file.mts`: each bad-file policy and the writer.
//
// `app/store/json-file.mts`: each bad-file policy on a missing, oversized, unparsable or refused file (`empty` hands the salvage undefined, also when the salvage throws, and moves nothing; `aside` moves the file to `.corrupt`, a newer one to a timestamped name, and says why, with `ioErrors: "throw"` throwing a failed read; `skip` throws), and the writer creating the folder with the indent, trailing newline and the data folder's file and folder modes. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

const dir = (): string => mkdtempSync(join(tmpdir(), "pr-json-file-"));

test("[fast] json-file: empty hands the salvage the document, or undefined for a missing, oversized or unparsable file", () => {
  const d = dir(), f = join(d, "a.json");
  const salvage = (doc: unknown) => ({ got: doc });
  assert.deepEqual(readJsonFile(f, { onBad: "empty", salvage }), { got: undefined });
  writeFileSync(f, "{\"x\":1}");
  assert.deepEqual(readJsonFile(f, { onBad: "empty", salvage }), { got: { x: 1 } });
  assert.deepEqual(readJsonFile(f, { maxBytes: 3, onBad: "empty", salvage }), { got: undefined });
  writeFileSync(f, "{oops");
  assert.deepEqual(readJsonFile(f, { onBad: "empty", salvage }), { got: undefined });
  assert.ok(existsSync(f), "an empty read never moves the file");
  writeFileSync(f, "{\"x\":1}");
  assert.deepEqual(readJsonFile(f, { onBad: "empty", salvage: (doc) => { if (doc) throw new Error("bad"); return "empty"; } }), "empty", "a salvage that throws reads as an empty file");
});

test("[fast] json-file: aside moves a bad file to .corrupt and says why, and reads a missing file as missing", () => {
  const d = dir(), f = join(d, "a.json");
  assert.deepEqual(readJsonFile(f, { onBad: "aside" }), { missing: true });
  writeFileSync(f, "{oops");
  const syntax = readJsonFile(f, { onBad: "aside" });
  assert.ok("bad" in syntax && syntax.bad.why === "syntax" && "aside" in syntax && syntax.aside === `${f}.corrupt`, JSON.stringify(syntax));
  assert.ok(!existsSync(f) && existsSync(`${f}.corrupt`));
  writeFileSync(f, "[1]");
  const refused = readJsonFile(f, { onBad: "aside", check: (doc) => Array.isArray(doc) ? "not an object" : null });
  assert.ok("bad" in refused && refused.bad.why === "check" && refused.bad.reason === "not an object");
  assert.ok("aside" in refused && refused.aside.startsWith(`${f}.corrupt-`), "an older .corrupt keeps its name");
  writeFileSync(f, "{\"x\":1}");
  const big = readJsonFile(f, { maxBytes: 3, onBad: "aside" });
  assert.ok("bad" in big && big.bad.why === "too-big");
  writeFileSync(f, "{\"x\":1}");
  assert.deepEqual(readJsonFile(f, { onBad: "aside", check: () => null }), { doc: { x: 1 } });
});

test("[fast] json-file: aside with ioErrors throw throws a failed read, a missing file included, but still sets a bad file aside", () => {
  const d = dir(), f = join(d, "a.json");
  assert.throws(() => readJsonFile(f, { onBad: "aside", ioErrors: "throw" }), { code: "ENOENT" });
  assert.throws(() => readJsonFile(d, { onBad: "aside", ioErrors: "throw" }), { code: "EISDIR" });
  writeFileSync(f, "{oops");
  const r = readJsonFile(f, { onBad: "aside", ioErrors: "throw" });
  assert.ok("bad" in r && r.bad.why === "syntax" && "aside" in r);
});

test("[fast] json-file: skip returns the document and throws on anything else", () => {
  const d = dir(), f = join(d, "a.json");
  assert.throws(() => readJsonFile(f, { onBad: "skip" }), { code: "ENOENT" });
  writeFileSync(f, "{oops");
  assert.throws(() => readJsonFile(f, { onBad: "skip" }), SyntaxError);
  writeFileSync(f, "[1,2]");
  assert.deepEqual(readJsonFile(f, { onBad: "skip" }), [1, 2]);
});

test("[fast] json-file: writeJsonFile creates the folder and writes the indent, the trailing newline and the data file mode", () => {
  const d = dir(), f = join(d, "sub", "a.json");
  writeJsonFile(f, { a: [1] }, { indent: 1 });
  assert.equal(readFileSync(f, "utf8"), "{\n \"a\": [\n  1\n ]\n}\n");
  writeJsonFile(f, { a: 1 }, { newline: false });
  assert.equal(readFileSync(f, "utf8"), "{\"a\":1}");
  if (process.platform !== "win32") {
    assert.equal(statSync(f).mode & 0o777, 0o600);
    assert.equal(statSync(join(d, "sub")).mode & 0o777, 0o700);
  }
});
