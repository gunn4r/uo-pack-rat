// changelog.mts — the changelog's fragments: each pull request adds `changelog.d/<short-name>.md`, and a release puts them together into CHANGELOG.md.
//
// A fragment holds one or more entries, one line each, every line starting with "- " in CHANGELOG.md's style. CHANGELOG.md itself holds only released versions: its Unreleased section is a fixed pointer to changelog.d/ plus a seal, the SHA-256 of everything below it, so a direct edit to the file shows up as a broken seal. At release, the fragments go in newest first and are deleted, the player-facing entries first and then, under `### For contributors`, every entry starting "For contributors: " (in the bold title or before it), that prefix dropped (`sectionText`). An optional `changelog.d/_highlights.md`, the release's short summary in Markdown with no headings of its own, opens the section under `### Highlights`, and both entry lists are then folded into collapsed `<details>` blocks; it is deleted with the fragments. `--highlights` gives a version already released its summary the same way. Newest means the highest issue number at the start of the name (`338-changelog-fragments.md`, as the branch `338-changelog-fragments` names it), names without a number first, ties by name: the order depends on the file names alone, never on git history. A release with no fragments changes nothing.
//
//   node scripts/changelog.mts                       print the unreleased entries, as the release would write them
//   node scripts/changelog.mts --check               exit 1 when a fragment or CHANGELOG.md is out of shape
//   node scripts/changelog.mts --release <version>   move the fragments into CHANGELOG.md as <version> (package.json's version; --date YYYY-MM-DD, default today)
//   node scripts/changelog.mts --highlights <version> <file>   set a released version's highlights from <file> and re-seal
//   node scripts/changelog.mts --seal                re-seal CHANGELOG.md after a deliberate correction to a released entry
//
// scripts/changelog.test.mts runs --check's checks on the committed files.
//
// map: tooling
// owns: `fragmentError`, `changelogError`, `highlightsError`, `sectionText`, `withHighlights`, `release`
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CHANGELOG = "CHANGELOG.md";
export const FRAGMENTS = "changelog.d";
// The release's summary, written by hand before --release (RELEASING.md): not a fragment, and deleted with them.
export const HIGHLIGHTS = "_highlights.md";
const HEAD = "# Changelog\n\n## Unreleased\n\n";
const POINTER = "Entries not yet released are in `changelog.d/`, one file per pull request (`CONTRIBUTING.md`, Changelog). `node scripts/changelog.mts --release <version>` moves them here.";
const SEAL = /^<!-- released-sha256: ([0-9a-f]{64}) \(written by node scripts\/changelog\.mts\) -->$/;
const NAME = /^[a-z0-9][a-z0-9_-]*\.md$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const lf = (s: string): string => s.replace(/\r\n/g, "\n");
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

// What a fragment called `name` is missing, or null when it is in shape.
export function fragmentError(name: string, text: string): string | null {
  if (!NAME.test(name)) return `${name}: name it <short-name>.md, in lower case with hyphens or underscores (the branch name with / replaced by -)`;
  const lines = lf(text).split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return `${name} is empty`;
  const bad = lines.find((l) => !l.startsWith("- "));
  if (bad !== undefined) return `${name}: every line is one entry starting with "- " (one paragraph is one line), not "${bad.slice(0, 60)}"`;
  const odd = lines.find((l) => /^- (\*\*)?For contributors\b/.test(l) && !CONTRIBUTOR.test(l));
  return odd === undefined ? null : `${name}: a contributor entry starts "- **For contributors: " or "- For contributors: ", not "${odd.slice(0, 60)}"`;
}

// The entry lines of a fragment, trailing spaces trimmed.
const entries = (text: string): string[] => lf(text).split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");

// The fragment file names, newest first: highest leading issue number first, names without one before those, ties by name.
export function fragmentNames(root = ROOT): string[] {
  const dir = join(root, FRAGMENTS);
  if (!existsSync(dir)) return [];
  const issue = (f: string): number => { const m = /^(\d+)[-_.]/.exec(f); return m ? Number(m[1]) : Infinity; };
  return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md" && f !== HIGHLIGHTS)
    .sort((a, b) => issue(b) - issue(a) || (a < b ? -1 : a > b ? 1 : 0));
}

// CHANGELOG.md's released part (from the first version heading on) and its seal, or the reason it has neither.
function split(changelog: string): { released: string; seal: string | null } | { error: string } {
  const t = lf(changelog);
  if (!t.startsWith(HEAD)) return { error: `${CHANGELOG} must open with "# Changelog" and "## Unreleased"` };
  const at = t.indexOf("\n## ", HEAD.length - 1);
  const released = at < 0 ? "" : t.slice(at + 1);
  const unreleased = (at < 0 ? t.slice(HEAD.length) : t.slice(HEAD.length, at + 1)).trim().split("\n");
  if (unreleased.length !== 3 || unreleased[0] !== POINTER || unreleased[1] !== "") return { error: `${CHANGELOG}'s Unreleased section holds only the pointer to ${FRAGMENTS}/: put new entries in a fragment, ${FRAGMENTS}/<short-name>.md` };
  return { released, seal: SEAL.exec(unreleased[2]!)?.[1] ?? null };
}

const unreleasedBlock = (released: string): string => `${HEAD}${POINTER}\n\n<!-- released-sha256: ${sha(released)} (written by node scripts/changelog.mts) -->\n\n`;

// What is wrong with CHANGELOG.md, or null: its Unreleased section must be the pointer, and its seal must match the released part.
export function changelogError(changelog: string): string | null {
  const s = split(changelog);
  if ("error" in s) return s.error;
  if (s.seal !== sha(s.released)) return `${CHANGELOG}'s released entries changed by hand: new entries go in ${FRAGMENTS}/<short-name>.md. To correct a released entry on purpose, run node scripts/changelog.mts --seal`;
  return null;
}

// CHANGELOG.md re-sealed over its current released part.
export function sealed(changelog: string): string {
  const s = split(changelog);
  if ("error" in s) throw new Error(s.error);
  return unreleasedBlock(s.released) + s.released;
}

// What is wrong with a highlights text, or null: it must say something, and hold no heading of its own (the release
// writes "### Highlights" above it, and a "## " line would read as a version).
export function highlightsError(text: string): string | null {
  const t = lf(text).trim();
  if (!t) return `${HIGHLIGHTS} is empty`;
  const heading = t.split("\n").find((l) => l.startsWith("#"));
  return heading === undefined ? null : `${HIGHLIGHTS}: no headings ("${heading.slice(0, 40)}"); the release adds "### Highlights" itself`;
}

// A version section's entries as released: the player-facing ones first, then the contributor ones under their own
// subheading with the "For contributors: " prefix dropped, in the bold title or before it (its next letter capitalised), each group in the order
// given. With highlights, they open the section under "### Highlights" and both lists are folded into <details> blocks
// (GitHub shows them collapsed, with their count), so the summary is what a reader sees first.
const CONTRIBUTOR = /^- (\*\*)?For contributors: /;
export const CONTRIBUTORS_HEADING = "### For contributors";
export const HIGHLIGHTS_HEADING = "### Highlights";
const DETAILS_OPEN = /^<details><summary>[^<]*<\/summary>$/;
type Section = { highlights: string | null; players: string[]; contributors: string[] };
const folded = (summary: string, lines: string[]): string => `<details><summary>${summary}</summary>\n\n${lines.join("\n")}\n\n</details>`;
function renderSection({ highlights, players, contributors }: Section): string {
  const parts: string[] = [];
  if (highlights) parts.push(`${HIGHLIGHTS_HEADING}\n\n${highlights}`);
  if (players.length) parts.push(highlights ? folded(`All changes (${players.length})`, players) : players.join("\n"));
  if (contributors.length) parts.push(`${CONTRIBUTORS_HEADING}\n\n${highlights ? folded(`Contributor notes (${contributors.length})`, contributors) : contributors.join("\n")}`);
  return parts.join("\n\n");
}
export function sectionText(lines: string[], highlights: string | null = null): string {
  return renderSection({
    highlights: highlights === null ? null : lf(highlights).trim(),
    players: lines.filter((l) => !CONTRIBUTOR.test(l)),
    contributors: lines.filter((l) => CONTRIBUTOR.test(l)).map((l) => l.replace(CONTRIBUTOR, (_m, b?: string) => `- ${b ?? ""}`).replace(/^- (\*\*)?([a-z])/, (_m, b: string | undefined, c: string) => `- ${b ?? ""}${c.toUpperCase()}`)),
  });
}
// A released section's body read back into its parts, for --highlights: only the layout renderSection writes (entries,
// the two subheadings, the folded blocks); anything else (an older section's own subheadings) is refused.
function parseSection(body: string, version: string): Section {
  const out: Section = { highlights: null, players: [], contributors: [] };
  const hl: string[] = [];
  let mode: "entries" | "highlights" | "contributors" = "entries";
  for (const l of body.split("\n")) {
    if (l === HIGHLIGHTS_HEADING) { mode = "highlights"; continue; }
    if (l === CONTRIBUTORS_HEADING) { mode = "contributors"; continue; }
    if (DETAILS_OPEN.test(l) || l === "</details>") { if (mode === "highlights") mode = "entries"; continue; }
    if (mode === "highlights") { hl.push(l); continue; }
    if (l === "") continue;
    if (!l.startsWith("- ")) throw new Error(`${CHANGELOG}'s ${version} section has a line --highlights can't place: "${l.slice(0, 60)}"`);
    (mode === "contributors" ? out.contributors : out.players).push(l);
  }
  out.highlights = hl.join("\n").trim() || null;
  return out;
}

// CHANGELOG.md with `lines` released as `version` on `date` (with `highlights` above them when given), above the earlier versions; unchanged when there are no lines, so an empty or repeated release is a no-op.
export function released(changelog: string, lines: string[], version: string, date: string, highlights: string | null = null): string {
  const s = split(changelog);
  if ("error" in s) throw new Error(s.error);
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version like 1.2.3`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`"${date}" is not a date like 2026-10-17`);
  if (!lines.length) return changelog;
  if (s.released.split("\n").some((l) => l.startsWith(`## ${version} `))) throw new Error(`${CHANGELOG} already has ${version}: bump package.json's version for the new fragments`);
  const next = `## ${version} — ${date}\n\n${sectionText(lines, highlights)}\n\n${s.released}`;
  return unreleasedBlock(next) + next;
}

// CHANGELOG.md with released `version`'s highlights set to `text` (added, or replacing the ones it has) and its entries
// folded below them, re-sealed; every other section is left as it is.
export function withHighlights(changelog: string, version: string, text: string): string {
  const s = split(changelog);
  if ("error" in s) throw new Error(s.error);
  const bad = highlightsError(text);
  if (bad) throw new Error(bad);
  const start = s.released.split("\n").findIndex((l) => l.startsWith(`## ${version} `));
  if (start < 0) throw new Error(`${CHANGELOG} has no released ${version}`);
  const lines = s.released.split("\n"), rest = lines.slice(start + 1), end = rest.findIndex((l) => l.startsWith("## "));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n");
  const section = renderSection({ ...parseSection(body, version), highlights: lf(text).trim() });
  const next = [...lines.slice(0, start + 1), "", section, "", ...(end < 0 ? [] : rest.slice(end))].join("\n");
  return unreleasedBlock(next) + next;
}

// Every problem --check reports, for the fragments and CHANGELOG.md under `root`.
export function problems(root = ROOT): string[] {
  const out = fragmentNames(root).map((f) => fragmentError(f, readFileSync(join(root, FRAGMENTS, f), "utf8"))).filter((e): e is string => e !== null);
  const hl = readHighlights(root), hlBad = hl === null ? null : highlightsError(hl);
  if (hlBad) out.push(hlBad);
  const c = changelogError(readFileSync(join(root, CHANGELOG), "utf8"));
  return c ? [...out, c] : out;
}

// changelog.d/_highlights.md's text, or null when there is none.
export function readHighlights(root = ROOT): string | null {
  const path = join(root, FRAGMENTS, HIGHLIGHTS);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// The unreleased entries, newest fragment first (the plain order; sectionText groups them for the release).
export function unreleasedLines(root = ROOT): string[] {
  return fragmentNames(root).flatMap((f) => entries(readFileSync(join(root, FRAGMENTS, f), "utf8")));
}

// Releases `version` under `root`: writes CHANGELOG.md, the highlights first when changelog.d/_highlights.md exists, and deletes the fragments it took and the highlights, returning how many fragments. The version must be package.json's. With no fragments it writes nothing and returns 0.
export function release(version: string, date: string, root = ROOT): number {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
  if (pkg.version !== version) throw new Error(`package.json's version is ${pkg.version}, not ${version}: bump it first (RELEASING.md)`);
  const bad = problems(root);
  if (bad.length) throw new Error(bad.join("\n"));
  const names = fragmentNames(root);
  if (!names.length) return 0;
  const path = join(root, CHANGELOG);
  writeFileSync(path, released(readFileSync(path, "utf8"), unreleasedLines(root), version, date, readHighlights(root)));
  for (const f of names) rmSync(join(root, FRAGMENTS, f));
  rmSync(join(root, FRAGMENTS, HIGHLIGHTS), { force: true });
  return names.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  try {
    if (args.includes("--check")) {
      const bad = problems();
      for (const p of bad) console.error(p);
      process.exit(bad.length ? 1 : 0);
    } else if (args.includes("--release")) {
      const version = value("--release");
      if (!version) throw new Error("--release needs a version: node scripts/changelog.mts --release 1.2.3");
      const n = release(version, value("--date") ?? new Date().toISOString().slice(0, 10));
      console.log(n ? `${CHANGELOG}: ${version} released from ${n} fragment${n === 1 ? "" : "s"}, now deleted` : `${CHANGELOG} unchanged: ${FRAGMENTS}/ has no fragments to release`);
    } else if (args.includes("--highlights")) {
      const version = value("--highlights"), file = version === undefined ? undefined : args[args.indexOf("--highlights") + 2];
      if (!version || !file) throw new Error("--highlights needs a released version and a file: node scripts/changelog.mts --highlights 1.2.3 highlights.md");
      const path = join(ROOT, CHANGELOG);
      writeFileSync(path, withHighlights(readFileSync(path, "utf8"), version, readFileSync(file, "utf8")));
      console.log(`${CHANGELOG}: ${version}'s highlights set, re-sealed`);
    } else if (args.includes("--seal")) {
      const path = join(ROOT, CHANGELOG);
      writeFileSync(path, sealed(readFileSync(path, "utf8")));
      console.log(`${CHANGELOG} re-sealed`);
    } else console.log(sectionText(unreleasedLines(), readHighlights()));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
