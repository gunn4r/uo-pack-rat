// module-index.mts — the module tables in docs/module-map.md, generated from each module's own header.
//
// Every non-test `.mts` file under app/, scripts/ and electron/ describes itself in its leading comment: a line `// <name> — <role>` (the name may carry its folder, `ui/x.mts`), whose first sentence is the table's Role, then `// map: <area>`, the id of the table it belongs in, and `// owns: <names>`, the Owns column (left out: "—"). Each table sits in docs/module-map.md between `<!-- module-map:start <area> -->` and `<!-- module-map:end -->`, rows in path order; everything outside those markers is written by hand.
//
//   node scripts/module-index.mts           print the problems and the tables
//   node scripts/module-index.mts --write   rewrite docs/module-map.md's tables
//   node scripts/module-index.mts --check   exit 1 when a table is out of date or a module's header is out of shape
//
// scripts/module-map.test.mts runs --check's checks on the committed tree.
//
// map: tooling
// owns: `headerOf`, `renderTables`, `withTables`
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MAP = "docs/module-map.md";
const BLOCK = /<!-- module-map:start ([a-z0-9-]+) -->\n[\s\S]*?<!-- module-map:end -->/g;

export type ModuleHeader = { role: string; area: string; owns: string };

// Every non-test module in the tree, tracked or not yet added, as sorted repo-relative paths.
export function moduleFiles(root = ROOT): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "app", "scripts", "electron"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return [...new Set(out.split("\n"))].filter((f) => f.endsWith(".mts") && !f.endsWith(".test.mts") && !f.startsWith("app/dist/") && existsSync(join(root, f))).sort();
}

// A module's header, or what is missing from it. The leading comment may follow a `#!` line.
export function headerOf(file: string, text: string): ModuleHeader | string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines[0]?.startsWith("#!") ? 1 : 0;
  const comment: string[] = [];
  for (const l of lines.slice(start)) {
    if (!l.startsWith("//")) break;
    comment.push(l.replace(/^\/\/ ?/, ""));
  }
  const name = file.split("/").pop()!;
  const at = comment.findIndex((l) => /^\S+ — /.test(l));
  const head = at < 0 ? null : /^(\S+) — (.+)$/.exec(comment[at]!);
  if (!head || (head[1] !== name && !head[1]!.endsWith(`/${name}`))) return `${file}: its leading comment needs a line "// ${name} — <role>."`;
  const para = [head[2]!];
  for (const l of comment.slice(at + 1)) { if (l.trim() === "" || /^(map|owns): /.test(l)) break; para.push(l.trim()); }
  // A hard-wrapped line that ends inside a hyphenated word joins without a space.
  const joined = para.reduce((s, l) => (/\w-$/.test(s) ? s + l : `${s} ${l}`));
  const sentence = /^(.+?\.)(?:\s|$)/.exec(joined);
  if (!sentence) return `${file}: the role after "${name} — " needs a full stop`;
  const area = comment.map((l) => /^map: ([a-z0-9-]+)$/.exec(l)?.[1]).find(Boolean);
  if (!area) return `${file}: its leading comment needs a line "// map: <area>", naming its table in ${MAP}`;
  const owns = comment.map((l) => /^owns: (.+)$/.exec(l)?.[1]).find(Boolean) ?? "—";
  const role = sentence[1]!.replace(/^[a-z]+\b/, (w) => w[0]!.toUpperCase() + w.slice(1));
  return { role, area, owns };
}

const cell = (s: string): string => s.replace(/\|/g, "\\|");

// The tables for the modules under `root`, by area, and every problem found on the way.
export function renderTables(root = ROOT, areas?: string[]): { tables: Map<string, string>; problems: string[] } {
  const rows = new Map<string, string[]>();
  const problems: string[] = [];
  for (const f of moduleFiles(root)) {
    const h = headerOf(f, readFileSync(join(root, f), "utf8"));
    if (typeof h === "string") { problems.push(h); continue; }
    if (areas && !areas.includes(h.area)) { problems.push(`${f}: "// map: ${h.area}" names no table in ${MAP} (the areas: ${areas.join(", ")})`); continue; }
    (rows.get(h.area) ?? rows.set(h.area, []).get(h.area)!).push(`| \`${f}\` | ${cell(h.role)} | ${cell(h.owns)} |`);
  }
  const tables = new Map([...rows].map(([a, r]) => [a, `| Module | Role | Owns |\n|---|---|---|\n${r.join("\n")}`]));
  return { tables, problems };
}

// The areas docs/module-map.md has a table for, in order.
export const areasOf = (map: string): string[] => [...map.replace(/\r\n/g, "\n").matchAll(BLOCK)].map((m) => m[1]!);

// docs/module-map.md with every table replaced by `tables` (an area with no modules gets an empty table).
export function withTables(map: string, tables: Map<string, string>): string {
  return map.replace(/\r\n/g, "\n").replace(BLOCK, (_, area: string) => `<!-- module-map:start ${area} -->\n${tables.get(area) ?? "| Module | Role | Owns |\n|---|---|---|"}\n<!-- module-map:end -->`);
}

// The map as the headers give it, and the problems in the headers.
export function generated(root = ROOT): { current: string; next: string; problems: string[] } {
  const current = readFileSync(join(root, MAP), "utf8").replace(/\r\n/g, "\n");
  const { tables, problems } = renderTables(root, areasOf(current));
  return { current, next: withTables(current, tables), problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { current, next, problems } = generated();
  for (const p of problems) console.error(p);
  if (process.argv.includes("--check")) {
    if (next !== current) console.error(`${MAP}'s module tables are out of date: run npm run gen:modules`);
    process.exit(next !== current || problems.length ? 1 : 0);
  } else if (process.argv.includes("--write")) {
    if (next !== current) writeFileSync(join(ROOT, MAP), next);
    console.log(next === current ? "the module tables are current" : `${MAP}'s module tables rewritten`);
  } else console.log(next);
  if (problems.length) process.exit(1);
}
