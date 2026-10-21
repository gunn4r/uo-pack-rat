// changelog.test.mts — `scripts/changelog.mts`: a [smoke] guard that the committed fragments and CHANGELOG.md are in shape and every fragment's name starts with its issue number, a [smoke] release of a copy of them, and the release that puts the fragments together.
//
// The guard fails a pull request that adds entries to CHANGELOG.md or edits its released part by hand (the seal no longer matches); its message names the fix, a fragment in `changelog.d/`. The rest drives `fragmentError`, `sectionText` (player-facing entries first, then the contributor ones under `### For contributors` with their prefix dropped, each group in order; with highlights, a `### Highlights` summary on top and both lists folded into `<details>`), `highlightsError`, `released`, `withHighlights` (a released section given or re-given its highlights, every other section byte for byte as it was, and a section of another shape refused) and `release` (`_highlights.md` used and deleted, never read as a fragment) on strings and a throwaway folder.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG, CONTRIBUTORS_HEADING, FRAGMENTS, HIGHLIGHTS, changelogError, fragmentError, fragmentNames, highlightsError, problems, release, released, sealed, sectionText, unreleasedLines, withHighlights } from "./changelog.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A sealed CHANGELOG.md with one released version.
const OLD = "## 0.1.0 — 2026-09-27\n\n- **First.** The first release.\n";
const base = (): string => sealed(`# Changelog\n\n## Unreleased\n\nEntries not yet released are in \`changelog.d/\`, one file per pull request (\`CONTRIBUTING.md\`, Changelog). \`node scripts/changelog.mts --release <version>\` moves them here.\n\n<!-- released-sha256: ${"0".repeat(64)} (written by node scripts/changelog.mts) -->\n\n${OLD}`);

test("[smoke] the committed changelog fragments and CHANGELOG.md are in shape", () => {
  assert.deepEqual(problems(root), [], "new entries go in changelog.d/<short-name>.md, never in CHANGELOG.md (CONTRIBUTING.md, Changelog)");
});

// The release orders fragments by the issue number a name starts with; one without it sorts last, out of place.
test("[smoke] every committed fragment's name starts with its issue number and a hyphen", () => {
  assert.deepEqual(fragmentNames(root).filter((f) => !/^\d+-/.test(f)), [], "name it changelog.d/<issue>-<short-name>.md (changelog.d/README.md)");
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
  const section = after.slice(after.indexOf(`## ${version} `), after.indexOf("\n## ", after.indexOf(`## ${version} `) + 1));
  assert.ok(!section.includes("**For contributors: "), "every contributor entry lost its prefix");
  const contributors = new Set(unreleasedLines(root).filter((l) => l.startsWith("- **For contributors: ")).map((l) => sectionText([l]).split("\n").at(-1)));
  const heading = section.indexOf(`\n${CONTRIBUTORS_HEADING}\n`);
  assert.ok(!section.slice(0, heading < 0 ? section.length : heading).split("\n").some((l) => contributors.has(l)), "no contributor entry above the subheading");
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
  assert.equal(fragmentError("c.md", "- For contributors: `x` moved.\n- **For contributors: y** z.\n"), null);
  assert.match(fragmentError("c.md", "- For contributors (issue #1): `x` moved.\n")!, /contributor entry starts/);
});

test("[fast] sectionText puts the player-facing entries first and the contributor ones under their subheading, prefix dropped, each group in order", () => {
  const lines = ["- **Two.** Player.", "- **For contributors: one store** (issue #1): a.", "- **One.** Player.", "- **For contributors: `x.json` has a schema**: b."];
  assert.equal(sectionText(lines), `- **Two.** Player.\n- **One.** Player.\n\n${CONTRIBUTORS_HEADING}\n\n- **One store** (issue #1): a.\n- **\`x.json\` has a schema**: b.`);
  assert.equal(sectionText(["- **A.** Player."]), "- **A.** Player.", "no contributor entries: no subheading");
  assert.equal(sectionText(["- **For contributors: only** this."]), `${CONTRIBUTORS_HEADING}\n\n- **Only** this.`, "only contributor entries: the subheading alone");
  assert.equal(sectionText(["- **Not for contributors: x**"]), "- **Not for contributors: x**", "the prefix only at the start of the title");
  assert.equal(sectionText(["- **P.** p.", "- For contributors: `x` moved.", "- For contributors: the cache **grows**."]), `- **P.** p.\n\n${CONTRIBUTORS_HEADING}\n\n- \`x\` moved.\n- The cache **grows**.`, "the prefix before the title, unbolded, is a contributor entry too");
});

test("[fast] released puts the entries above the earlier versions and re-seals", () => {
  const next = released(base(), ["- **B.** Second.", "- **A.** First."], "0.2.0", "2026-10-17");
  assert.equal(changelogError(next), null);
  assert.ok(next.includes(`## 0.2.0 — 2026-10-17\n\n- **B.** Second.\n- **A.** First.\n\n${OLD}`));
  const grouped = released(base(), ["- **For contributors: c** x.", "- **P.** y."], "0.2.0", "2026-10-17");
  assert.ok(grouped.includes(`## 0.2.0 — 2026-10-17\n\n- **P.** y.\n\n${CONTRIBUTORS_HEADING}\n\n- **C** x.\n\n${OLD}`), "contributor entries under their subheading, the earlier version untouched");
  assert.equal(changelogError(grouped), null);
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

const HL = "Pack Rat X is a big one.\n\n**Group**\n- One thing.\n- Another.";
test("[fast] highlights open the section under their heading and fold both entry lists, with their counts", () => {
  assert.equal(sectionText(["- **P.** p.", "- **For contributors: c** c.", "- **Q.** q."], `\n${HL}\n\n`),
    `### Highlights\n\n${HL}\n\n<details><summary>All changes (2)</summary>\n\n- **P.** p.\n- **Q.** q.\n\n</details>\n\n${CONTRIBUTORS_HEADING}\n\n<details><summary>Contributor notes (1)</summary>\n\n- **C** c.\n\n</details>`);
  assert.equal(sectionText(["- **P.** p."]), "- **P.** p.", "no highlights: nothing folded");
  assert.equal(highlightsError(HL), null);
  assert.match(highlightsError(" \n")!, /empty/);
  assert.match(highlightsError("## Highlights\n- x")!, /no headings/);
});

test("[fast] withHighlights gives a released section its highlights or replaces them, re-seals, and leaves every other section as it was", () => {
  const two = released(base(), ["- **For contributors: c** c.", "- **P.** p."], "0.2.0", "2026-10-17");
  const three = released(two, ["- **N.** n."], "0.3.0", "2026-10-18");
  const set = withHighlights(three, "0.2.0", HL);
  assert.equal(changelogError(set), null, "re-sealed");
  const sectionOf = (c: string, v: string): string => { const a = c.indexOf(`## ${v} `); const b = c.indexOf("\n## ", a + 1); return c.slice(a, b < 0 ? undefined : b); };
  assert.equal(sectionOf(set, "0.2.0"), `## 0.2.0 — 2026-10-17\n\n${sectionText(["- **P.** p.", "- **For contributors: c** c."], HL)}\n`);
  assert.equal(sectionOf(set, "0.3.0"), sectionOf(three, "0.3.0"), "a later section untouched");
  assert.ok(set.endsWith(OLD), "an earlier section untouched");
  assert.equal(withHighlights(set, "0.2.0", HL), set, "the same highlights again change nothing");
  const other = withHighlights(set, "0.2.0", "Something else.");
  assert.ok(other.includes("### Highlights\n\nSomething else.\n\n<details><summary>All changes (1)</summary>") && !other.includes("big one"), "new highlights replace the old");
  assert.throws(() => withHighlights(set, "0.9.0", HL), /no released 0\.9\.0/);
  assert.throws(() => withHighlights(set, "0.2.0", "# Title"), /no headings/);
  const security = sealed(base().replace("- **First.** The first release.\n", "- **First.** The first release.\n\n### Security\n\n- **S.** s.\n"));
  assert.throws(() => withHighlights(security, "0.1.0", HL), /can't place: "### Security"/);
});

test("[fast] release takes changelog.d/_highlights.md as the section's highlights, never as a fragment, and deletes it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "packrat-changelog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, FRAGMENTS));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "0.2.0" }));
  writeFileSync(join(dir, CHANGELOG), base());
  writeFileSync(join(dir, FRAGMENTS, "1-a.md"), "- **A.** a.\n");
  writeFileSync(join(dir, FRAGMENTS, HIGHLIGHTS), "## Not allowed\n");
  assert.deepEqual(fragmentNames(dir), ["1-a.md"]);
  assert.throws(() => release("0.2.0", "2026-10-17", dir), /no headings/, "highlights out of shape stop the release");
  writeFileSync(join(dir, FRAGMENTS, HIGHLIGHTS), `${HL}\n`);
  assert.equal(release("0.2.0", "2026-10-17", dir), 1);
  assert.ok(readFileSync(join(dir, CHANGELOG), "utf8").includes(`## 0.2.0 — 2026-10-17\n\n${sectionText(["- **A.** a."], HL)}\n\n## 0.1.0`));
  assert.deepEqual(readdirSync(join(dir, FRAGMENTS)), [], "the highlights went with the fragments");
});
