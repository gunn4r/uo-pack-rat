// changelog.mts — the changelog's fragments: each pull request adds `changelog.d/<short-name>.md`, and a release puts them together into CHANGELOG.md.
//
// A fragment holds one or more entries, one line each, every line starting with "- " in CHANGELOG.md's style. CHANGELOG.md itself holds only released versions: its Unreleased section is a fixed pointer to changelog.d/ plus a seal, the SHA-256 of everything below it, so a direct edit to the file shows up as a broken seal. At release, the fragments go in newest first and are deleted, the player-facing entries first and then, under `### For contributors`, every entry whose title starts with "For contributors: ", that prefix dropped (`sectionText`). Newest means the highest issue number at the start of the name (`338-changelog-fragments.md`, as the branch `338-changelog-fragments` names it), names without a number first, ties by name: the order depends on the file names alone, never on git history. A release with no fragments changes nothing.
//
//   node scripts/changelog.mts                       print the unreleased entries, as the release would write them
//   node scripts/changelog.mts --check               exit 1 when a fragment or CHANGELOG.md is out of shape
//   node scripts/changelog.mts --release <version>   move the fragments into CHANGELOG.md as <version> (package.json's version; --date YYYY-MM-DD, default today)
//   node scripts/changelog.mts --seal                re-seal CHANGELOG.md after a deliberate correction to a released entry
//
// scripts/changelog.test.mts runs --check's checks on the committed files.
//
// map: tooling
// owns: `fragmentError`, `changelogError`, `sectionText`, `release`
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CHANGELOG = "CHANGELOG.md";
export const FRAGMENTS = "changelog.d";
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
  return bad === undefined ? null : `${name}: every line is one entry starting with "- " (one paragraph is one line), not "${bad.slice(0, 60)}"`;
}

// The entry lines of a fragment, trailing spaces trimmed.
const entries = (text: string): string[] => lf(text).split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");

// The fragment file names, newest first: highest leading issue number first, names without one before those, ties by name.
export function fragmentNames(root = ROOT): string[] {
  const dir = join(root, FRAGMENTS);
  if (!existsSync(dir)) return [];
  const issue = (f: string): number => { const m = /^(\d+)[-_.]/.exec(f); return m ? Number(m[1]) : Infinity; };
  return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md")
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

// A version section's entries as released: the player-facing ones first, then the contributor ones under their own
// subheading with the title's "For contributors: " prefix dropped (its next letter capitalised), each group in the order given.
const CONTRIBUTOR = /^- \*\*For contributors: /;
export const CONTRIBUTORS_HEADING = "### For contributors";
export function sectionText(lines: string[]): string {
  const players = lines.filter((l) => !CONTRIBUTOR.test(l));
  const contributors = lines.filter((l) => CONTRIBUTOR.test(l)).map((l) => l.replace(CONTRIBUTOR, "- **").replace(/^- \*\*([a-z])/, (_m, c: string) => `- **${c.toUpperCase()}`));
  return [players.join("\n"), contributors.length ? `${CONTRIBUTORS_HEADING}\n\n${contributors.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

// CHANGELOG.md with `lines` released as `version` on `date`, above the earlier versions; unchanged when there are no lines, so an empty or repeated release is a no-op.
export function released(changelog: string, lines: string[], version: string, date: string): string {
  const s = split(changelog);
  if ("error" in s) throw new Error(s.error);
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version like 1.2.3`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`"${date}" is not a date like 2026-10-17`);
  if (!lines.length) return changelog;
  if (s.released.split("\n").some((l) => l.startsWith(`## ${version} `))) throw new Error(`${CHANGELOG} already has ${version}: bump package.json's version for the new fragments`);
  const next = `## ${version} — ${date}\n\n${sectionText(lines)}\n\n${s.released}`;
  return unreleasedBlock(next) + next;
}

// Every problem --check reports, for the fragments and CHANGELOG.md under `root`.
export function problems(root = ROOT): string[] {
  const out = fragmentNames(root).map((f) => fragmentError(f, readFileSync(join(root, FRAGMENTS, f), "utf8"))).filter((e): e is string => e !== null);
  const c = changelogError(readFileSync(join(root, CHANGELOG), "utf8"));
  return c ? [...out, c] : out;
}

// The unreleased entries, newest fragment first (the plain order; sectionText groups them for the release).
export function unreleasedLines(root = ROOT): string[] {
  return fragmentNames(root).flatMap((f) => entries(readFileSync(join(root, FRAGMENTS, f), "utf8")));
}

// Releases `version` under `root`: writes CHANGELOG.md and deletes the fragments it took, returning how many. The version must be package.json's. With no fragments it writes nothing and returns 0.
export function release(version: string, date: string, root = ROOT): number {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
  if (pkg.version !== version) throw new Error(`package.json's version is ${pkg.version}, not ${version}: bump it first (RELEASING.md)`);
  const bad = problems(root);
  if (bad.length) throw new Error(bad.join("\n"));
  const names = fragmentNames(root);
  if (!names.length) return 0;
  const path = join(root, CHANGELOG);
  writeFileSync(path, released(readFileSync(path, "utf8"), unreleasedLines(root), version, date));
  for (const f of names) rmSync(join(root, FRAGMENTS, f));
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
    } else if (args.includes("--seal")) {
      const path = join(ROOT, CHANGELOG);
      writeFileSync(path, sealed(readFileSync(path, "utf8")));
      console.log(`${CHANGELOG} re-sealed`);
    } else console.log(sectionText(unreleasedLines()));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
