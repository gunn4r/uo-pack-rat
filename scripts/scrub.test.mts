// scrub.test.mts — this repository is public. Nothing tracked in it may carry the maintainer's
// identity or machine, the private workspace it grew out of, real in-game character names, or the
// retired product name. The allowances below are deliberate and each one says why.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Scan everything EXCEPT known-binary extensions, so extensionless text files (LICENSE,
// .gitattributes, .gitignore, and whatever else shows up later) are covered by default instead of
// silently skipped — an allowlist-by-extension missed exactly those three files before.
const BINARY = /\.(png|jpe?g|gif|ico|icns|bmp|svg|woff2?|ttf|eot|otf|pdf|zip|tar|gz|dmg|exe|dll|so|dylib|wasm|db|sqlite3?)$/i;

// [pattern, why it is banned, paths allowed to contain it]
const BANNED: [RegExp, string, string[]][] = [
  [/gunnar|gabrielson/i, "the maintainer's name or machine", ["scripts/scrub.test.mts"]],
  [/gunn4r/i, "the maintainer's account — only the repository URL may carry it",
    ["package.json", "package-lock.json", "README.md", "CONTRIBUTING.md", "SECURITY.md", "RELEASING.md",
     ".github/ISSUE_TEMPLATE/config.yml", "scripts/packaging.test.mts", "scripts/scrub.test.mts",
     "docs/superpowers/plans/2026-09-17-phase-5-packaging.md",
     "docs/superpowers/plans/2026-09-17-phase-6-adapters.md",
     // LICENSE: MIT needs an identifiable copyright holder, and gunn4r is the public account name —
     // already the repository owner, the electron-builder appId and package.json's author.
     "LICENSE"]],
  [/ultima_online/i, "the private workspace path", ["scripts/scrub.test.mts"]],
  [/\/Users\/(?!example)[a-z0-9._-]+/i, "a real home directory", ["scripts/scrub.test.mts"]],
  [/\b(Mythos|Titania|Tenthumbs)\b/, "a real character name", ["scripts/scrub.test.mts"]],
  [/quartermaster/i, "the retired product name", ["scripts/scrub.test.mts"]],
];

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n").filter((f) => f && !BINARY.test(f));

test("[smoke] no tracked file carries private data or a retired name", () => {
  const found: string[] = [];
  for (const file of tracked) {
    const body = readFileSync(join(root, file), "utf8");
    for (const [pattern, why, allowed] of BANNED) {
      if (allowed.includes(file)) continue;
      const hit = body.match(pattern);
      if (hit) found.push(`${file}: ${why} — "${hit[0]}"`);
    }
  }
  assert.deepEqual(found, [], `private data in tracked files:\n${found.join("\n")}`);
});

test("[smoke] the guard actually sees tracked files", () => {
  assert.ok(tracked.length > 40, `expected the repo's files, got ${tracked.length}`);
});
