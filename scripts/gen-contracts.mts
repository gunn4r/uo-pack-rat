// gen-contracts.mts — copy the adapters' shared Python helpers from adapters/_shared/ into every script
// that carries them, between `# BEGIN generated: <fragment>` / `# END generated: <fragment>` markers, render each script's manifest constants from its capabilities.json, and write the web scanner's TypeScript copies (`// BEGIN generated:` blocks) through a TypeScript emitter; --check fails when a committed script differs. Each script must install as a single file (TazUO lists every .py in its scripts
// folder as a runnable script, and Razor Enhanced has no import path to a sibling file), so the copies
// stay; this makes them generated instead of hand-kept.
//
// A script marks each copy with a pair of comment lines:
//   # BEGIN generated: <fragment>
//   # END generated: <fragment>
// and the lines between them are replaced by adapters/_shared/<fragment>.py. A fragment named
// "<adapter>/<name>" belongs to that adapter alone; one without a slash is shared by every adapter.
// Two fragments are rendered instead of read: "manifest" (ADAPTER_ID, ADAPTER_VERSION and CAPABILITIES) and
// "manifest_version" (the first two), from the script's own adapters/<id>/capabilities.json, so a version bump is one
// edit there and a run of this script.
// A TypeScript script (the web scanner, adapters/<id>/packrat-*.ts) marks its blocks with `// BEGIN generated:` and
// `// END generated:` lines and takes the same constants as TypeScript: "manifest", and the TypeScript form of the
// Python fragments in TS_FRAGMENTS (the container graphics and the trash rule), so both clients' copies have one source.
// A fragment a Razor Enhanced script carries must stay ASCII with no f-strings, since Razor Enhanced
// runs IronPython.
//
// Usage: node scripts/gen-contracts.mts           rewrites every script whose blocks are out of date
//        node scripts/gen-contracts.mts --check   rewrites nothing; exits 1 naming each stale script
//
// map: installer
// owns: `generate`, `splice`, `fragmentProblems`, `renderManifest`, `tsFragment`
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const ADAPTERS = join(ROOT, "adapters");
export const SHARED = join(ADAPTERS, "_shared");
// A script's language, which sets its comment mark: "#" for Python, "//" for TypeScript.
export type Lang = "py" | "ts";
const MARKERS: Record<Lang, { begin: RegExp; end: RegExp }> = {
  py: { begin: /^# BEGIN generated: (\S+)$/, end: /^# END generated: (\S+)$/ },
  ts: { begin: /^\/\/ BEGIN generated: (\S+)$/, end: /^\/\/ END generated: (\S+)$/ },
};
const langOf = (path: string): Lang => (path.endsWith(".ts") ? "ts" : "py");
// Razor Enhanced's IronPython 2.7 has no f-strings; this catches the prefix forms (f, rf, fr, any case).
const F_STRING = /(?<![\w.])(?:[fF][rR]?|[rR][fF])["']/;

// Every adapter script the installer copies into a game client, or the app serves: adapters/<id>/packrat-*.py and .ts.
export function adapterScripts(adapters = ADAPTERS): string[] {
  const out: string[] = [];
  for (const d of readdirSync(adapters, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith("_")) continue;
    for (const f of readdirSync(join(adapters, d.name)).sort()) {
      if (f.startsWith("packrat-") && (f.endsWith(".py") || f.endsWith(".ts"))) out.push(join(adapters, d.name, f));
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
  if (/^(#|\/\/) (BEGIN|END) generated: /m.test(text)) out.push(`${name} contains a generated marker`);
  if (adapter === "razor-enhanced") {
    if (/[^\x00-\x7f]/.test(text)) out.push(`${name} is not ASCII, and Razor Enhanced runs IronPython`);
    if (text.split("\n").some((l) => F_STRING.test(l.replace(/#.*$/, "")))) out.push(`${name} uses an f-string, which IronPython cannot parse`);
  }
  return out;
}

// Rewrite every marked block in `source` from `fragment(name)`. Throws on an unmatched or nested
// marker, a fragment that does not exist, or a fragment the script's adapter may not carry.
export function splice(source: string, fragment: (name: string) => string | null, adapter: string, label = "script", lang: Lang = "py"): { text: string; used: string[] } {
  const { begin: BEGIN, end: END } = MARKERS[lang];
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
    if (text === null) throw new Error(lang === "ts" ? `${label}:${i + 1}: no TypeScript form of ${name} (manifest, or one of ${TS_FRAGMENTS.join(", ")})` : `${label}:${i + 1}: no fragment adapters/_shared/${name}.py`);
    const problems = fragmentProblems(name, text, adapter);
    if (problems.length) throw new Error(`${label}:${i + 1}: ${problems.join("; ")}`);
    out.push(lines[i]!, ...text.slice(0, -1).split("\n"), lines[j]!);
    used.push(name);
    i = j;
  }
  return { text: out.join("\n"), used };
}

// The manifest fragments, rendered from capabilities.json rather than read from adapters/_shared/.
export const MANIFEST_FRAGMENTS = ["manifest", "manifest_version"];
const WIDTH = 100;
// A JSON value as a Python literal (True/False/None) or a TypeScript one, with ASCII strings (IronPython), so the same
// text runs everywhere.
function lit(v: unknown, at: string, lang: Lang = "py"): string {
  if (typeof v === "boolean") return lang === "py" ? (v ? "True" : "False") : String(v);
  if (v === null) return lang === "py" ? "None" : "null";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") {
    if (/[^\x20-\x7e]/.test(v)) throw new Error(`${at} must be printable ASCII, since Razor Enhanced runs IronPython`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => lit(x, `${at}[${i}]`, lang)).join(", ")}]`;
  throw new Error(`${at} must be a list, a string, a number, true, false or null`);
}
// `items` after `prefix`, separated by ", ", wrapped at WIDTH under the first item, the last one followed by `close`.
function wrap(prefix: string, items: string[], close: string): string[] {
  if (!items.length) return [prefix + close];
  const pad = " ".repeat(prefix.length), lines: string[] = [];
  let line = prefix;
  items.forEach((item, i) => {
    const piece = item + (i === items.length - 1 ? close : ",");
    const fresh = line === prefix || line === pad;
    if (!fresh && line.length + 1 + piece.length > WIDTH) { lines.push(line); line = pad + piece; }
    else line += (fresh ? "" : " ") + piece;
  });
  lines.push(line);
  return lines;
}
// Fragment `name` ("manifest" or "manifest_version") for the manifest `doc` (an adapter's capabilities.json), in
// Python or (`lang` "ts") TypeScript. A list in CAPABILITIES gets its own line, wrapped; the values between lists share one.
export function renderManifest(name: string, doc: unknown, at = "capabilities.json", lang: Lang = "py"): string {
  const m = doc as { adapter?: unknown; version?: unknown; capabilities?: unknown };
  const [decl, end, indent] = lang === "py" ? ["", "", "    "] : ["const ", ";", "  "];
  const key = (k: string): string => (lang === "ts" && /^[A-Za-z_$][\w$]*$/.test(k) ? k : lit(k, `${at} capabilities key`));
  const lines = [`${decl}ADAPTER_ID = ${lit(m.adapter, `${at} adapter`, lang)}${end}`, `${decl}ADAPTER_VERSION = ${lit(m.version, `${at} version`, lang)}${end}`];
  if (name === "manifest") {
    const caps = m.capabilities;
    if (!caps || typeof caps !== "object" || Array.isArray(caps)) throw new Error(`${at} capabilities must be an object`);
    lines.push(`${decl}CAPABILITIES = {`);
    let scalars: string[] = [];
    const flush = (): void => { if (scalars.length) lines.push(...wrap(indent, scalars, ",")); scalars = []; };
    for (const [k, v] of Object.entries(caps)) {
      // An empty TypeScript list is typed string[] (every capability list holds names), not never[].
      if (Array.isArray(v)) { flush(); lines.push(...wrap(`${indent}${key(k)}: [`, v.map((x, i) => lit(x, `${at} capabilities.${k}[${i}]`, lang)), lang === "ts" && !v.length ? "] as string[]," : "],")); }
      else scalars.push(`${key(k)}: ${lit(v, `${at} capabilities.${k}`, lang)}`);
    }
    flush();
    lines.push(`}${end}`);
  }
  return `${lines.join("\n")}\n`;
}

// The Python fragments a TypeScript script can carry, each read from its own adapters/_shared/<name>.py.
export const TS_FRAGMENTS = ["container_graphics", "trash_re"];
// Fragment `name`'s TypeScript form, from its Python text: CONTAINER_GRAPHICS's set as an array of the same numbers,
// TRASH_RE's pattern as a regular expression literal with the same flag. Throws when the Python is not that shape.
export function tsFragment(name: string, python: string): string {
  if (name === "container_graphics") {
    const set = /^CONTAINER_GRAPHICS = \{([^}]*)\}(?:[ \t]*#.*)?\n$/.exec(python.replace(/\n\s+/g, " "));
    const ids = set ? set[1]!.split(",").map((t) => t.trim()).filter(Boolean) : [];
    if (!set || !ids.every((t) => /^0x[0-9A-Fa-f]{1,4}$/.test(t))) throw new Error("adapters/_shared/container_graphics.py must be one CONTAINER_GRAPHICS = {0x…, …} set");
    return `${["const CONTAINER_GRAPHICS = [", ...wrap("  ", ids.map((t) => `0x${parseInt(t, 16).toString(16).padStart(4, "0")}`), ""), "];"].join("\n")}\n`;
  }
  if (name === "trash_re") {
    const re = /^TRASH_RE = re\.compile\(r"((?:[^"\\]|\\.)*)"(, re\.I)?\)\n$/.exec(python);
    if (!re) throw new Error('adapters/_shared/trash_re.py must be one TRASH_RE = re.compile(r"…"[, re.I]) line');
    return `const TRASH_RE = /${re[1]!.replace(/\//g, "\\/")}/${re[2] ? "i" : ""};\n`;
  }
  throw new Error(`no TypeScript form of ${name}`);
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
  const manifestOf = (adapter: string): unknown => JSON.parse(readFileSync(join(adapters, adapter, "capabilities.json"), "utf8"));
  const files = new Map<string, string>();
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const p of adapterScripts(adapters)) {
    // Compared with LF endings: a Windows checkout (.gitattributes text=auto) has CRLF. A rewrite keeps the script's own.
    const raw = readFileSync(p, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const before = raw.replace(/\r\n/g, "\n");
    const adapter = relative(adapters, dirname(p));
    const label = relative(dirname(adapters), p), lang = langOf(p);
    const manifest = (name: string): string => renderManifest(name, manifestOf(adapter), `adapters/${adapter}/capabilities.json`, lang);
    const forScript = lang === "py"
      ? (name: string): string | null => (MANIFEST_FRAGMENTS.includes(name) ? manifest(name) : fragment(name))
      : (name: string): string | null => {
        if (name === "manifest") return manifest(name);
        const python = TS_FRAGMENTS.includes(name) ? fragment(name) : null;
        return python === null ? null : tsFragment(name, python);
      };
    const { text, used } = splice(before, forScript, adapter, label, lang);
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
