// scrub.test.mts — a [smoke] guard: this repository is public, and nothing tracked in it may carry private details.
//
// the `[smoke]` guard described in `CONTRIBUTING.md`'s "The scrub guard" section: fails the suite if any tracked file carries a private pattern, the public account name outside its allow-list, the retired product name, or a non-placeholder `/Users/…` path. Private patterns are never written here: they come from the machine running the test (its user name, home folder and git identity, skipped in CI), from `~/.config/pack-rat/scrub-private.txt` and from the `PACKRAT_SCRUB_PRIVATE` environment variable. Runs over `git ls-files`, so it only sees what's actually tracked. Also a canary: a word from an injected private list in a temporary file is flagged, as is a stubbed git identity, and a private hit is reported without its text.
//
// The allowances below are deliberate and each one says why.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Scan everything EXCEPT known-binary extensions, so extensionless text files (LICENSE,
// .gitattributes, .gitignore, and whatever else shows up later) are covered by default instead of
// silently skipped — an allowlist-by-extension missed exactly those three files before.
const BINARY = /\.(png|jpe?g|gif|ico|icns|bmp|svg|woff2?|ttf|eot|otf|pdf|zip|tar|gz|dmg|exe|dll|so|dylib|wasm|db|sqlite3?)$/i;

// [pattern, why it is banned, paths allowed to contain it]. Nothing private: those patterns come from privateWords.
type Row = [RegExp, string, string[]];
const PUBLIC_ROWS: Row[] = [
  [/gunn4r/i, "the maintainer's account — only the repository URL may carry it",
    ["package.json", "package-lock.json", "README.md", "docs/user-guide.md", "CONTRIBUTING.md", "SECURITY.md", "RELEASING.md",
     ".github/ISSUE_TEMPLATE/config.yml",
     // the Ko-fi page: GitHub's Sponsor button, and the sidebar's "Buy me a coffee" link
     ".github/FUNDING.yml", "app/index.html", "scripts/packaging.test.mts", "scripts/scrub.test.mts",
     // LICENSE: MIT needs an identifiable copyright holder, and gunn4r is the public account name —
     // already the repository owner, the electron-builder appId and package.json's author.
     "LICENSE"]],
  [/\/Users\/(?!example)[a-z0-9._-]+/i, "a real home directory", ["scripts/scrub.test.mts"]],
  [/quartermaster/i, "the retired product name", ["scripts/scrub.test.mts"]],
];

// Where the private words come from, each part replaceable so the tests can stub it.
export interface PrivateSources {
  env: NodeJS.ProcessEnv;
  // The machine's user name and home folder; skipped in CI, where they are the runner's.
  user: () => string;
  home: () => string;
  git: (key: string) => string;
  // The private list's text, or "" when there is none.
  listFile: () => string;
}
const quiet = (f: () => string): string => { try { return f(); } catch { return ""; } };
export const MACHINE: PrivateSources = {
  env: process.env,
  user: () => userInfo().username,
  home: () => basename(homedir()),
  git: (key) => execFileSync("git", ["config", key], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
  listFile: () => { const f = join(homedir(), ".config", "pack-rat", "scrub-private.txt"); return existsSync(f) ? readFileSync(f, "utf8") : ""; },
};

// The private words, lower-cased: each listed one as it is (the file's lines, `#` starting a comment, and the
// environment variable's comma-separated entries), and the machine's identity (user name, home folder, git name and the
// email's local part) whole and as its words of four letters or more. A word a public row already covers (the account
// name) is left to that row and its allow-list.
export function privateWords(src: PrivateSources = MACHINE): string[] {
  const words = new Set<string>();
  const add = (s: string): void => { const w = s.trim().toLowerCase(); if (w.length >= 4) words.add(w); };
  for (const line of quiet(src.listFile).split(/\r?\n/)) add(line.replace(/#.*/, ""));
  for (const entry of (src.env.PACKRAT_SCRUB_PRIVATE ?? "").split(",")) add(entry);
  if (!src.env.CI) {
    for (const id of [quiet(src.user), quiet(src.home), quiet(() => src.git("user.name")), quiet(() => src.git("user.email")).split("@")[0] ?? ""]) {
      if (PUBLIC_ROWS.some(([re]) => re.test(id))) continue;
      add(id);
      for (const w of id.split(/[^A-Za-z]+/)) add(w);
    }
  }
  return [...words].filter((w) => !PUBLIC_ROWS.some(([re]) => re.test(w)));
}
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One whole-word, case-insensitive pattern per private word. No file is allowed to carry one, this one included.
export const privateRows = (words: string[]): Row[] => words.map((w) => [new RegExp(`(?<![A-Za-z0-9])${escape(w)}(?![A-Za-z0-9])`, "i"), "private", []]);

// What the rows find in these files under `dir`. A private hit names the file only, never the text, since CI logs are public.
export function scan(dir: string, files: string[], rows: Row[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const body = readFileSync(join(dir, file), "utf8");
    for (const [pattern, why, allowed] of rows) {
      if (allowed.includes(file)) continue;
      const hit = body.match(pattern);
      if (hit) found.push(why === "private" ? `${file}: a private pattern` : `${file}: ${why} — "${hit[0]}"`);
    }
  }
  return found;
}

// Listed inside the tests, not at load: outside a git checkout (a source archive) git fails, and a
// tracked file deleted in the working tree is not there to read.
function trackedFiles(): string[] | null {
  let out: string;
  try { out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
  return out.split("\n").filter((f) => f && !BINARY.test(f) && existsSync(join(root, f)));
}

test("[smoke] no tracked file carries private data or a retired name", (t) => {
  const tracked = trackedFiles();
  if (!tracked) return t.skip("not a git checkout");
  const found = scan(root, tracked, [...PUBLIC_ROWS, ...privateRows(privateWords())]);
  assert.deepEqual(found, [], `private data in tracked files:\n${found.join("\n")}`);
});

test("[smoke] the guard actually sees tracked files", (t) => {
  const tracked = trackedFiles();
  if (!tracked) return t.skip("not a git checkout");
  assert.ok(tracked.length > 40, `expected the repo's files, got ${tracked.length}`);
});

// Stubbed sources: nothing from the machine, so the canaries never see a real name.
const stub = (over: Partial<PrivateSources> = {}): PrivateSources => ({ env: {}, user: () => "", home: () => "", git: () => "", listFile: () => "", ...over });

test("[smoke] scrub canary: a word from the injected private list in a file is flagged, whole words only, without its text", () => {
  const dir = mkdtempSync(join(tmpdir(), "scrub-canary-"));
  try {
    writeFileSync(join(dir, "leak.md"), "A note about Zorblaxian's house.\n");
    writeFileSync(join(dir, "fine.md"), "The zorblaxians_cache and xzorblaxian are other words.\n");
    const words = privateWords(stub({ env: { PACKRAT_SCRUB_PRIVATE: " zorblaxian , qwvex" } }));
    assert.deepEqual(words, ["zorblaxian", "qwvex"]);
    assert.deepEqual(scan(dir, ["leak.md", "fine.md"], privateRows(words)), ["leak.md: a private pattern"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("[smoke] scrub: the private list file's lines, and the machine's identity outside CI, become private words", () => {
  assert.deepEqual(privateWords(stub({ listFile: () => "# a comment\nVexmoor Keep\n\nqwvex # trailing note\n" })), ["vexmoor keep", "qwvex"]);
  const identity = stub({ user: () => "jdoe", home: () => "jdoe.work", git: (k) => (k === "user.name" ? "Jaxon Q Doevitch" : "jdoe.dev@example.org") });
  assert.deepEqual(privateWords(identity), ["jdoe", "jdoe.work", "work", "jaxon q doevitch", "jaxon", "doevitch", "jdoe.dev"]);
  assert.deepEqual(privateWords({ ...identity, env: { CI: "true" } }), [], "in CI the identity is the runner's, so it is skipped");
  assert.deepEqual(privateWords(stub({ git: (k) => (k === "user.name" ? "gunn4r" : "") })), [], "the public account name is left to its own row");
  assert.deepEqual(privateWords(stub({ user: () => { throw new Error("no user"); }, listFile: () => { throw new Error("unreadable"); } })), []);
});
