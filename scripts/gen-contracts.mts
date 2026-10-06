// gen-contracts.mts — copy the adapters' shared Python helpers from adapters/_shared/ into every script
// that carries them. Each script must install as a single file (TazUO lists every .py in its scripts
// folder as a runnable script, and Razor Enhanced has no import path to a sibling file), so the copies
// stay; this makes them generated instead of hand-kept.
//
// A script marks each copy with a pair of comment lines:
//   # BEGIN generated: <fragment>
//   # END generated: <fragment>
// and the lines between them are replaced by adapters/_shared/<fragment>.py. A fragment named
// "<adapter>/<name>" belongs to that adapter alone; one without a slash is shared by every adapter.
// A fragment a Razor Enhanced script carries must stay ASCII with no f-strings, since Razor Enhanced
// runs IronPython.
//
// Usage: node scripts/gen-contracts.mts           rewrites every script whose blocks are out of date
//        node scripts/gen-contracts.mts --check   rewrites nothing; exits 1 naming each stale script
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const ADAPTERS = join(ROOT, "adapters");
export const SHARED = join(ADAPTERS, "_shared");
const BEGIN = /^# BEGIN generated: (\S+)$/;
const END = /^# END generated: (\S+)$/;
// Razor Enhanced's IronPython 2.7 has no f-strings; this catches the prefix forms (f, rf, fr, any case).
const F_STRING = /(?<![\w.])(?:[fF][rR]?|[rR][fF])["']/;

// Every adapter script the installer copies into a game client: adapters/<id>/packrat-*.py.
export function adapterScripts(adapters = ADAPTERS): string[] {
  const out: string[] = [];
  for (const d of readdirSync(adapters, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith("_")) continue;
    for (const f of readdirSync(join(adapters, d.name)).sort()) {
      if (f.startsWith("packrat-") && f.endsWith(".py")) out.push(join(adapters, d.name, f));
    }
  }
  return out.sort();
}

// Problems with putting `text` (fragment `name`) into a script of `adapter`, or [] when it is fine.
export function fragmentProblems(name: string, text: string, adapter: string): string[] {
  const out: string[] = [];
  const owner = name.includes("/") ? name.slice(0, name.indexOf("/")) : null;
  if (owner !== null && owner !== adapter) out.push(`${name} belongs to ${owner}, not ${adapter}`);
  if (!text.endsWith("\n") || text.endsWith("\n\n")) out.push(`${name} must end with exactly one newline`);
  if (/^# (BEGIN|END) generated: /m.test(text)) out.push(`${name} contains a generated marker`);
  if (adapter === "razor-enhanced") {
    if (/[^\x00-\x7f]/.test(text)) out.push(`${name} is not ASCII, and Razor Enhanced runs IronPython`);
    if (text.split("\n").some((l) => F_STRING.test(l.replace(/#.*$/, "")))) out.push(`${name} uses an f-string, which IronPython cannot parse`);
  }
  return out;
}

// Rewrite every marked block in `source` from `fragment(name)`. Throws on an unmatched or nested
// marker, a fragment that does not exist, or a fragment the script's adapter may not carry.
export function splice(source: string, fragment: (name: string) => string | null, adapter: string, label = "script"): { text: string; used: string[] } {
  const lines = source.split("\n");
  const out: string[] = [];
  const used: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const begin = BEGIN.exec(lines[i]!);
    if (END.test(lines[i]!)) throw new Error(`${label}:${i + 1}: END marker with no BEGIN`);
    if (!begin) { out.push(lines[i]!); continue; }
    const name = begin[1]!;
    let j = i + 1;
    while (j < lines.length && !BEGIN.test(lines[j]!) && !END.test(lines[j]!)) j++;
    if (j === lines.length || END.exec(lines[j]!)?.[1] !== name) throw new Error(`${label}:${i + 1}: BEGIN ${name} has no matching END before the next marker`);
    const text = fragment(name);
    if (text === null) throw new Error(`${label}:${i + 1}: no fragment adapters/_shared/${name}.py`);
    const problems = fragmentProblems(name, text, adapter);
    if (problems.length) throw new Error(`${label}:${i + 1}: ${problems.join("; ")}`);
    out.push(lines[i]!, ...text.slice(0, -1).split("\n"), lines[j]!);
    used.push(name);
    i = j;
  }
  return { text: out.join("\n"), used };
}

function readFragment(shared: string): (name: string) => string | null {
  return (name) => {
    if (!/^(?:[a-z0-9-]+\/)?[a-z0-9_]+$/.test(name)) return null;
    const p = join(shared, `${name}.py`);
    return existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n/g, "\n") : null;
  };
}

// Every fragment file under `shared`, as names ("rfc3339_now", "tazuo/walk").
export function fragmentNames(shared = SHARED): string[] {
  const out: string[] = [];
  for (const d of readdirSync(shared, { withFileTypes: true })) {
    if (d.isFile() && d.name.endsWith(".py")) out.push(d.name.slice(0, -3));
    else if (d.isDirectory()) {
      for (const f of readdirSync(join(shared, d.name))) if (f.endsWith(".py")) out.push(`${d.name}/${f.slice(0, -3)}`);
    }
  }
  return out.sort();
}

// Regenerate every adapter script in memory. `stale` lists the scripts whose committed text differs;
// `unused` lists fragment files no script carries (a fragment nobody uses is a copy nobody checks).
export function generate(adapters = ADAPTERS): { files: Map<string, string>; stale: string[]; unused: string[] } {
  const shared = join(adapters, "_shared");
  const fragment = readFragment(shared);
  const files = new Map<string, string>();
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const p of adapterScripts(adapters)) {
    // Compared with LF endings: a Windows checkout (.gitattributes text=auto) has CRLF. A rewrite keeps the script's own.
    const raw = readFileSync(p, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const before = raw.replace(/\r\n/g, "\n");
    const adapter = relative(adapters, dirname(p));
    const { text, used } = splice(before, fragment, adapter, relative(dirname(adapters), p));
    used.forEach((n) => seen.add(n));
    files.set(p, eol === "\n" ? text : text.replace(/\n/g, eol));
    if (text !== before) stale.push(p);
  }
  const unused = existsSync(shared) ? fragmentNames(shared).filter((n) => !seen.has(n)) : [];
  return { files, stale, unused };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const { files, stale, unused } = generate();
  for (const n of unused) console.error(`adapters/_shared/${n}.py is carried by no script`);
  if (check) {
    for (const p of stale) console.error(`${relative(ROOT, p)} is out of date: run node scripts/gen-contracts.mts`);
    process.exit(stale.length || unused.length ? 1 : 0);
  }
  for (const p of stale) writeFileSync(p, files.get(p)!);
  console.log(`${stale.length} of ${files.size} adapter scripts rewritten`);
  if (unused.length) process.exit(1);
}
