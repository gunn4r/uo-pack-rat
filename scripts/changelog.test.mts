// changelog.test.mts — `scripts/changelog.mts`: a [smoke] guard that the committed fragments and CHANGELOG.md are in shape, a [smoke] release of a copy of them, and the release that puts the fragments together.
//
// The guard fails a pull request that adds entries to CHANGELOG.md or edits its released part by hand (the seal no longer matches); its message names the fix, a fragment in `changelog.d/`. The rest drives `fragmentError`, `released` and `release` on strings and a throwaway folder.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG, FRAGMENTS, changelogError, fragmentError, fragmentNames, problems, release, released, sealed } from "./changelog.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A sealed CHANGELOG.md with one released version.
const OLD = "## 0.1.0 — 2026-09-27\n\n- **First.** The first release.\n";
const base = (): string => sealed(`# Changelog\n\n## Unreleased\n\nEntries not yet released are in \`changelog.d/\`, one file per pull request (\`CONTRIBUTING.md\`, Changelog). \`node scripts/changelog.mts --release <version>\` moves them here.\n\n<!-- released-sha256: ${"0".repeat(64)} (written by node scripts/changelog.mts) -->\n\n${OLD}`);

test("[smoke] the committed changelog fragments and CHANGELOG.md are in shape", () => {
  assert.deepEqual(problems(root), [], "new entries go in changelog.d/<short-name>.md, never in CHANGELOG.md (CONTRIBUTING.md, Changelog)");
});

// A throwaway copy of the committed CHANGELOG.md and fragments, with package.json bumped to a version not yet released.
function copyOfRepo(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "packrat-changelog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, FRAGMENTS));
  copyFileSync(join(root, CHANGELOG), join(dir, CHANGELOG));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "999.0.0" }));
  for (const f of readdirSync(join(root, FRAGMENTS))) copyFileSync(join(root, FRAGMENTS, f), join(dir, FRAGMENTS, f));
  return dir;
}

// The release commit deletes every fragment, so the guard must pass with none, and running the release again must change nothing.
test("[smoke] releasing the committed fragments leaves a tree the guard passes, and a second release is a no-op", (t) => {
  const dir = copyOfRepo(t);
  const version = "999.0.0";
  const n = fragmentNames(dir).length;
  assert.equal(release(version, "2026-10-17", dir), n);
  assert.deepEqual(readdirSync(join(dir, FRAGMENTS)), ["README.md"]);
  assert.deepEqual(problems(dir), [], "the release commit passes the guard with zero fragments");
  const after = readFileSync(join(dir, CHANGELOG), "utf8");
  assert.equal(release(version, "2026-10-18", dir), 0);
  assert.equal(readFileSync(join(dir, CHANGELOG), "utf8"), after, "a second release writes nothing");
});

test("[fast] a sealed CHANGELOG.md passes, and an entry added to it or an edit to a released one fails", () => {
  const c = base();
  assert.equal(changelogError(c), null);
  assert.equal(changelogError(c.replace(/\n/g, "\r\n")), null, "a CRLF checkout reads the same");
  assert.match(changelogError(c.replace("## Unreleased\n\n", "## Unreleased\n\n- **New.** Added by hand.\n\n"))!, /only the pointer/);
  assert.match(changelogError(c.replace("The first release.", "The first release, edited."))!, /changed by hand.*--seal/);
  assert.match(changelogError(`${c}\n- **Late.** Appended to the end.\n`)!, /changed by hand/);
  assert.equal(changelogError(sealed(c.replace("The first release.", "The first release, corrected."))), null, "--seal accepts a deliberate correction");
  assert.match(changelogError("# Notes\n")!, /must open with/);
});

test("[fast] fragmentError takes one-line entries in a lower-case file name", () => {
  assert.equal(fragmentError("fix-thing.md", "- **Fixed.** A thing (issue #1).\n"), null);
  assert.equal(fragmentError("two.md", "- **One.** First.\r\n\r\n- **Two.** Second.\r\n"), null);
  assert.equal(fragmentError("338-fix_thing.md", "- **Fixed.**\n"), null, "a branch name with / replaced by - works");
  assert.match(fragmentError("Fix-Thing.md", "- **Fixed.**\n")!, /lower case/);
  assert.match(fragmentError("feature/x.md", "- **Fixed.**\n")!, /replaced by -/);
  assert.match(fragmentError("empty.md", "\n\n")!, /empty/);
  assert.match(fragmentError("wrapped.md", "- **Fixed.** A long entry\n  wrapped onto a second line.\n")!, /one paragraph is one line/);
  assert.match(fragmentError("heading.md", "## Unreleased\n- **Fixed.**\n")!, /starting with "- "/);
});

test("[fast] released puts the entries above the earlier versions and re-seals", () => {
  const next = released(base(), ["- **B.** Second.", "- **A.** First."], "0.2.0", "2026-10-17");
  assert.equal(changelogError(next), null);
  assert.ok(next.includes(`## 0.2.0 — 2026-10-17\n\n- **B.** Second.\n- **A.** First.\n\n${OLD}`));
  assert.throws(() => released(next, ["- **C.**"], "0.2.0", "2026-10-18"), /already has 0\.2\.0/);
  assert.equal(released(base(), [], "0.2.0", "2026-10-17"), base(), "no entries: unchanged");
  assert.equal(released(next, [], "0.2.0", "2026-10-18"), next, "a repeated release with nothing new: unchanged");
  assert.throws(() => released(base(), ["- **C.**"], "v0.2", "2026-10-17"), /not a version/);
  assert.throws(() => released(base(), ["- **C.**"], "0.2.0", "17/10/2026"), /not a date/);
});

test("[fast] release writes CHANGELOG.md from the fragments, deletes them, and wants package.json's version", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "packrat-changelog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, FRAGMENTS));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "0.2.0" }));
  writeFileSync(join(dir, CHANGELOG), base());
  writeFileSync(join(dir, FRAGMENTS, "README.md"), "# Not a fragment\n");
  writeFileSync(join(dir, FRAGMENTS, "9-old.md"), "- **Old.** Issue 9.\n");
  writeFileSync(join(dir, FRAGMENTS, "12-new.md"), "- **New.** Issue 12.\n- **Newer line.** Same file.\n");
  writeFileSync(join(dir, FRAGMENTS, "b-plain.md"), "- **B.** No number.\n");
  writeFileSync(join(dir, FRAGMENTS, "a-plain.md"), "- **A.** No number.\n");
  assert.throws(() => release("0.3.0", "2026-10-17", dir), /package\.json's version is 0\.2\.0/);
  // The order comes from the names alone: no number first (by name), then the highest issue number first (12 before 9, not "12" < "9").
  assert.deepEqual(fragmentNames(dir), ["a-plain.md", "b-plain.md", "12-new.md", "9-old.md"]);
  assert.equal(release("0.2.0", "2026-10-17", dir), 4);
  const out = readFileSync(join(dir, CHANGELOG), "utf8");
  assert.equal(changelogError(out), null);
  assert.ok(out.includes("## 0.2.0 — 2026-10-17\n\n- **A.** No number.\n- **B.** No number.\n- **New.** Issue 12.\n- **Newer line.** Same file.\n- **Old.** Issue 9.\n\n## 0.1.0"));
  assert.deepEqual(readdirSync(join(dir, FRAGMENTS)), ["README.md"]);
  writeFileSync(join(dir, FRAGMENTS, "bad.md"), "not an entry\n");
  assert.throws(() => release("0.2.0", "2026-10-18", dir), /bad\.md/, "a fragment out of shape stops the release");
  rmSync(join(dir, FRAGMENTS, "bad.md"));
  assert.equal(release("0.2.0", "2026-10-18", dir), 0, "an empty release is a no-op, not an error");
  assert.equal(readFileSync(join(dir, CHANGELOG), "utf8"), out);
});
