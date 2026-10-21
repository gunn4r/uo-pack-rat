// docs-freshness.test.mts — a [smoke] guard that the Markdown stays readable and true to the code (issue #338).
//
// Over every Markdown file in the tree (untracked ones included; CHANGELOG.md and changelog.d/ left out, since a history names what has since gone): each doc is within its size budget (a guide within 5 KB, every other doc within its entry in BUDGETS, a little above its size when it was set, so a doc that grows past it fails until it is trimmed or its budget is raised on purpose); no prose line is over 2,500 characters (a paragraph that long reads as a log entry; table rows and fenced code are left alone); every backticked code name (camelCase, CONSTANT_CASE or `name()`) occurs in the code, or is in EXTERNAL with the reason; every guide (a CLAUDE.md below the root, or docs/guides/*.md) opens with the five headings Read with:, Invariants, Extend it, Tests and Traps, in that order; and the root CLAUDE.md names every guide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Every doc's size budget in bytes, but the guides', which share GUIDE_BUDGET. Raise one only on purpose, saying why in
// the pull request; lower it when a doc shrinks for good.
const BUDGETS: Record<string, number> = {
  ".github/PULL_REQUEST_TEMPLATE.md": 2000,
  "adapters/classicuo-web/README.md": 18000,
  "adapters/razor-enhanced/README.md": 38000,
  "adapters/tazuo/README.md": 33000,
  "app/bench/README.md": 8000,
  "app/bench/REPORT.md": 41000,
  "app/fixtures/README.md": 5000,
  "app/schema/README.md": 5000,
  "build/README.md": 3000,
  "CLAUDE.md": 7000,
  "CODE_OF_CONDUCT.md": 3000,
  "CONTRIBUTING.md": 21000,
  "docs/adapter-guide.md": 33000,
  "docs/architecture.md": 85000,
  "docs/bridge-protocol.md": 52000,
  "docs/change-checklists.md": 23000,
  "docs/mcp.md": 17000,
  "docs/module-map.md": 93000,
  "docs/scan-schema.md": 37000,
  "docs/server.md": 12000,
  "docs/shard-rules.md": 22000,
  "docs/solver.md": 110000,
  "docs/threat-model.md": 52000,
  "docs/user-guide.md": 21000,
  "docs/ui.md": 28000,
  "docs/ui/characters.md": 10000,
  "docs/ui/forms.md": 9000,
  "docs/ui/house-map.md": 39000,
  "docs/ui/inventory.md": 36200,   // + the gear item (issue #504) on the peek, the tooltip, Scrolls and Unravel
  "docs/ui/organize.md": 13000,
  "docs/ui/suit-builder.md": 98000,
  "electron/README.md": 14000,
  "PRIVACY.md": 16000,
  "README.md": 8000,
  "RELEASING.md": 17000,
  "SECURITY.md": 6000,
  "TESTING.md": 60000,
};
const GUIDE_BUDGET = 5 * 1024;
const LINE_BUDGET = 2500;
const GUIDE_HEADINGS = ["Read with:", "Invariants", "Extend it", "Tests", "Traps"];

// Code names the docs use that no file here defines, with the reason.
const EXTERNAL: Record<string, string> = {
  closeAllGumps: "the ClassicUO web client's scripting API, which adapters/classicuo-web/README.md describes",
  closeCorpses: "the ClassicUO web client's scripting API, which adapters/classicuo-web/README.md describes",
  insertAdjacentHTML: "a DOM API, which CONTRIBUTING.md forbids",
  outerHTML: "a DOM API, which CONTRIBUTING.md forbids",
};

// Docs the line and code-name checks skip for now, with the reason. An entry whose doc passes both fails, so it goes once fixed.
const PENDING: Record<string, string> = {
};

// Listed inside the tests, not at load: outside a git checkout (a source archive) git fails.
function tree(): string[] | null {
  try { return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter((f) => f && existsSync(join(root, f))); } catch { return null; }
}
const docsOf = (files: string[]): string[] => files.filter((f) => f.endsWith(".md") && f !== "CHANGELOG.md" && !f.startsWith("changelog.d/"));
export const isGuide = (f: string): boolean => f.endsWith("/CLAUDE.md") || /^docs\/guides\/[^/]+\.md$/.test(f);

// The lines of `text` a reader reads as prose: not a table row, not inside a fenced code block.
export function proseLines(text: string): Array<{ line: number; length: number }> {
  const out: Array<{ line: number; length: number }> = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; return; }
    if (!fenced && !l.trimStart().startsWith("|")) out.push({ line: i + 1, length: [...l].length });
  });
  return out;
}

// The backticked spans of `text` that name code: camelCase, CONSTANT_CASE or name(), as the name alone.
const CODE_NAME = /^(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+|[A-Za-z_$][\w$]*\(\))$/;
export function codeNames(text: string): string[] {
  return [...new Set([...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!.trim()).filter((s) => CODE_NAME.test(s)).map((s) => s.replace(/\(\)$/, "")))];
}

// Every word in the code (this file aside, since it names the EXTERNAL and PENDING entries).
function codeWords(files: string[]): Set<string> {
  const words = new Set<string>();
  for (const f of files.filter((f) => /\.(mts|ts|mjs|js|py|json|html|css|yml|sh)$/.test(f) && f !== "scripts/docs-freshness.test.mts")) for (const m of readFileSync(join(root, f), "utf8").matchAll(/[A-Za-z_$][\w$]*/g)) words.add(m[0]);
  return words;
}

// The `## ` headings of `text`, in order.
export const headingsOf = (text: string): string[] => [...text.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]!);

test("[smoke] docs-freshness: every doc is within its size budget, and every budget names a doc", (t) => {
  const files = tree();
  if (!files) return t.skip("not a git checkout");
  const docs = docsOf(files);
  const over: string[] = [], unbudgeted: string[] = [];
  for (const f of docs) {
    const budget = isGuide(f) ? GUIDE_BUDGET : BUDGETS[f];
    if (budget === undefined) { unbudgeted.push(f); continue; }
    const size = Buffer.byteLength(readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n"));   // the committed size: Windows checks text out with CRLF
    if (size > budget) over.push(`${f}: ${size} bytes, budget ${budget}`);
  }
  assert.deepEqual(unbudgeted, [], "give each new doc an entry in BUDGETS, a little above its size");
  assert.deepEqual(over, [], "trim the doc, or raise its budget on purpose and say why in the pull request");
  assert.deepEqual(Object.keys(BUDGETS).filter((f) => !docs.includes(f) || isGuide(f)), [], "a BUDGETS entry names a doc that is gone, or a guide (guides share GUIDE_BUDGET)");
});

test(`[smoke] docs-freshness: no prose line is over ${LINE_BUDGET} characters`, (t) => {
  const files = tree();
  if (!files) return t.skip("not a git checkout");
  const long = docsOf(files).filter((f) => !(f in PENDING)).flatMap((f) => proseLines(readFileSync(join(root, f), "utf8")).filter((l) => l.length > LINE_BUDGET).map((l) => `${f}:${l.line}: ${l.length} characters`));
  assert.deepEqual(long, [], "split the paragraph at a sentence boundary (a list item goes on as an indented paragraph of the same item)");
});

test("[smoke] docs-freshness: every backticked code name in the docs occurs in the code, or is in EXTERNAL with its reason", (t) => {
  const files = tree();
  if (!files) return t.skip("not a git checkout");
  const words = codeWords(files);
  const unknown = docsOf(files).filter((f) => !(f in PENDING)).flatMap((f) => codeNames(readFileSync(join(root, f), "utf8")).filter((n) => !words.has(n) && !(n in EXTERNAL)).map((n) => `${f}: \`${n}\``));
  assert.deepEqual(unknown, [], "fix the doc to the code's current name, or add the name to EXTERNAL with why it is not in the code");
  assert.deepEqual(Object.keys(EXTERNAL).filter((n) => words.has(n) || !docsOf(files).some((f) => codeNames(readFileSync(join(root, f), "utf8")).includes(n))), [], "an EXTERNAL entry the code now defines, or no doc names any more");
});

test("[smoke] docs-freshness: every PENDING doc still fails a check it is excused from", (t) => {
  const files = tree();
  if (!files) return t.skip("not a git checkout");
  const words = codeWords(files);
  const clean = Object.keys(PENDING).filter((f) => {
    const text = readFileSync(join(root, f), "utf8");
    return !proseLines(text).some((l) => l.length > LINE_BUDGET) && codeNames(text).every((n) => words.has(n) || n in EXTERNAL);
  });
  assert.deepEqual(clean, [], "these pass every check now: remove them from PENDING");
});

test("[smoke] docs-freshness: every guide opens with the five headings, and the root CLAUDE.md names it", (t) => {
  const files = tree();
  if (!files) return t.skip("not a git checkout");
  const guides = docsOf(files).filter(isGuide);
  assert.ok(guides.length > 0, "found the guides");
  const rootText = readFileSync(join(root, "CLAUDE.md"), "utf8");
  const bad = guides.filter((g) => headingsOf(readFileSync(join(root, g), "utf8")).slice(0, GUIDE_HEADINGS.length).join("|") !== GUIDE_HEADINGS.join("|")).map((g) => `${g}: ${headingsOf(readFileSync(join(root, g), "utf8")).slice(0, GUIDE_HEADINGS.length).join(", ")}`);
  assert.deepEqual(bad, [], `a guide's first headings are ## ${GUIDE_HEADINGS.join(", ## ")}`);
  assert.deepEqual(guides.filter((g) => !rootText.includes(`\`${g}\``)), [], "name each guide in the root CLAUDE.md's guide table");
});

test("[fast] docs-freshness: proseLines skips tables and fenced code; codeNames and headingsOf read what they say", () => {
  assert.deepEqual(proseLines("a\n| x |\n```\nlong\n```\nbb").map((l) => [l.line, l.length]), [[1, 1], [6, 2]]);
  assert.deepEqual(codeNames("`fooBar` `LIMIT_X` `run()` `plain` `a.b` `fooBar`").sort(), ["LIMIT_X", "fooBar", "run"]);
  assert.deepEqual(headingsOf("# T\n## Read with:\ntext\n### sub\n## Traps\n"), ["Read with:", "Traps"]);
  assert.ok(isGuide("app/ui/CLAUDE.md") && isGuide("docs/guides/x.md") && !isGuide("CLAUDE.md") && !isGuide("docs/ui.md"));
});
