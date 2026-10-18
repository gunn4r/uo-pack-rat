// select-tests.mts — the mapping behind `./scripts/test_runner.sh --changed`: from the files a branch
// changed to the test files worth running for them. Pure, so scripts/select-tests.test.mts can prove
// every rule; scripts/test-runner.mts asks git for the changed paths and reads the sources.
//
// Rules, per changed path (repo-relative, forward slashes), first match wins:
//   1. docs and the like (*.md, docs/, .github/, LICENSE, a node_modules symlink) select nothing;
//   2. shared test infrastructure, the build, the Electron shell and the schema run the full suite;
//   3. a test file runs itself (a deleted one is dropped);
//   4. anything under adapters/ runs app/adapters.test.mts, which runs every adapters/**/test_*.py,
//      app/adapter-outputs.test.mts, which checks what the scanners and bridges write, and
//      scripts/gen-contracts.test.mts, which checks the generated copies of adapters/_shared/;
//   5. otherwise the test files that reach the path: through a chain of relative string literals
//      ("./x.mts", "../y.css" — imports, dynamic imports and new URL() alike), or, for a file that
//      is not a module (JSON, CSS, HTML), by naming it in quotes ("demo-Kestrel.json"). Under app/ui
//      (and app/index.html) the Electron screen tests for it are added too, from SCREENS; a
//      stylesheet adds the contrast test. A path nothing reaches runs the full suite.
//
// map: tooling
// owns: `selectTests`, `SCREENS`
import { posix } from "node:path";

export type Selection = { full: string } | { tests: Record<string, string[]> };

const IGNORED = /(^|\/)[^/]+\.md$|^docs\/|^\.github\/|^LICENSE$|^node_modules(\/|$)/;
const FULL = /^(scripts\/(test-runner|run-suite|test-file-watchdog|electron-window|build-ui|build-schema-types)\.mts|scripts\/test_runner\.sh|package(-lock)?\.json|tsconfig[^/]*\.json|app\/schema\/.*|electron\/.*)$/;

// app/ui file stem → the Electron test(s) that drive that screen; a name ending in * stands for every Electron test whose name
// starts with the rest (the Suit Builder's are split by area). A stem not listed here (tokens, dom, store, app, theme...) is
// shared by every screen, so it selects all of them.
export const SCREENS: Record<string, string | string[]> = {
  builder: "ui-builder-*", "builder-model": "ui-builder-*", "builder-result": "ui-builder-*",
  components: "ui-components",
  import: "ui-forms", "import-preview": "ui-forms", wizard: "ui-forms", settings: "ui-forms", shard: "ui-forms",
  shell: "ui-shell",
  inventory: "ui-state", "inv-model": "ui-state", characters: "ui-state", roster: "ui-state", sheet: "ui-state",
  runs: "ui-state", peek: "ui-state", containers: "ui-state", "view-state": "ui-state",
  scrolls: "ui-scrolls", "scrolls-model": "ui-scrolls",
  "house-map": "ui-map", "house-map-model": "ui-map", "world-map": "ui-map", "world-map-model": "ui-map",
  organize: "ui-organize", "auto-organize": "ui-organize", "rule-editor": "ui-organize",
  "organize-model": ["ui-organize", "ui-map"], kinds: "ui-organize",
  "builder-buffs": "ui-builder-*", "builder-header": "ui-builder-*", "builder-templates": "ui-builder-*", "builder-requirements": "ui-builder-*", "builder-manual": "ui-builder-*", "manual-model": "ui-builder-*",
  "item-browser": ["ui-state", "ui-builder-*"],
};

const LITERAL = /["'`](\.\.?\/[^"'`\s]+)["'`]/g;
const refsOf = (file: string, text: string): string[] =>
  [...text.matchAll(LITERAL)].map((m) => posix.normalize(posix.join(posix.dirname(file), m[1]!)));

// `sources` maps every .mts file under app/, scripts/ and electron/ (tests included) to its text.
export function selectTests(changed: string[], sources: Record<string, string>): Selection {
  const tests = Object.keys(sources).filter((f) => f.endsWith(".test.mts")).sort();
  const electronUi = tests.filter((f) => /^scripts\/ui-[^/]+\.test\.mts$/.test(f));
  const refs = new Map(Object.entries(sources).map(([f, text]) => [f, refsOf(f, text)]));
  // Every module a test reaches, itself included.
  const reach = new Map(tests.map((t) => {
    const seen = new Set<string>();
    const visit = (f: string): void => {
      if (seen.has(f) || !(f in sources)) return;
      seen.add(f);
      for (const r of refs.get(f)!) visit(r);
    };
    visit(t);
    return [t, seen];
  }));
  const picked: Record<string, string[]> = {};
  const pick = (test: string, path: string): void => {
    if (test in sources && !(picked[test] ??= []).includes(path)) picked[test]!.push(path);
  };

  for (const path of changed) {
    if (IGNORED.test(path)) continue;
    if (FULL.test(path)) return { full: `${path} is shared test infrastructure` };
    if (path.endsWith(".test.mts")) { if (path in sources) pick(path, path); continue; }
    if (path.startsWith("adapters/")) { pick("app/adapters.test.mts", path); pick("app/adapter-outputs.test.mts", path); pick("scripts/gen-contracts.test.mts", path); continue; }
    const quoted = path.endsWith(".mts") ? null : `"${posix.basename(path)}"`;
    const names = (f: string): boolean => refs.get(f)!.includes(path) || (quoted !== null && sources[f]!.includes(quoted));
    for (const t of tests) if ([...reach.get(t)!].some(names)) pick(t, path);
    if (path.startsWith("app/ui/") || path === "app/index.html") {
      const screen = SCREENS[posix.basename(path).replace(/\.(mts|css)$/, "")];
      const named = (n: string): string[] => (n.endsWith("*") ? electronUi.filter((f) => f.startsWith(`scripts/${n.slice(0, -1)}`)) : [`scripts/${n}.test.mts`]);
      for (const t of screen ? [screen].flat().flatMap(named) : electronUi) pick(t, path);
      if (path.endsWith(".css")) pick("scripts/ui-contrast.test.mts", path);
    }
    if (!Object.values(picked).some((p) => p.includes(path))) return { full: `no test reaches ${path}` };
  }
  return { tests: picked };
}

// The files that open an Electron window: the UI tests and the shell smoke test.
export const ELECTRON_FILE = /^scripts\/(ui-[^/]+|shell-smoke)\.test\.mts$/;
// CI's parts (issue #338): `only` keeps the Node files or the Electron ones, and `shard` k of n deals what is left into n
// shards of about the same number of tests (largest file first, each to the shard with the fewest tests so far, names breaking
// ties), so every file lands in exactly one shard and a shard's files stay the same from run to run. `tests` is a file's
// test count. Paths are repo-relative. A part that leaves no file throws: a CI job that runs nothing must fail, not pass
// (a renamed test file or a shard count above the file count would otherwise go green with no test run).
export interface Part { only?: "node" | "electron" | undefined; shard?: { k: number; n: number } | undefined }
export function partOf(files: Array<{ path: string; tests: number }>, { only, shard }: Part): string[] {
  const kept = files.filter((f) => !only || ELECTRON_FILE.test(f.path) === (only === "electron"));
  const none = (): Error => new Error(`${[only && `--only-${only}`, shard && `--shard=${shard.k}/${shard.n}`].filter(Boolean).join(" ")} selected no test files`);
  if (!shard) { if (only && !kept.length) throw none(); return kept.map((f) => f.path).sort(); }
  const load = Array.from({ length: shard.n }, () => 0), mine: string[] = [];
  for (const f of [...kept].sort((a, b) => b.tests - a.tests || a.path.localeCompare(b.path))) {
    const to = load.indexOf(Math.min(...load));
    load[to]! += Math.max(1, f.tests);
    if (to === shard.k - 1) mine.push(f.path);
  }
  if (!mine.length) throw none();
  return mine.sort();
}
// The part a test-runner command line asks for (--only-node, --only-electron, --shard=k/n), or why it is not one: an unknown
// --only-* (a typo would otherwise run the whole suite in that job), both --only flags, or a bad --shard.
export function parsePart(argv: string[]): Part | { error: string } {
  const only = argv.filter((a) => a.startsWith("--only-"));
  const bad = only.find((a) => a !== "--only-node" && a !== "--only-electron");
  if (bad) return { error: `${bad}: expected --only-node or --only-electron` };
  if (new Set(only).size > 1) return { error: "--only-node and --only-electron: give one" };
  const shardArg = argv.find((a) => a.startsWith("--shard="));
  const shard = shardArg ? parseShard(shardArg.slice("--shard=".length)) : undefined;
  if (shard === null) return { error: `${shardArg}: expected --shard=<k>/<n> with 1 <= k <= n` };
  return { only: only[0]?.slice("--only-".length) as Part["only"], shard };
}
// A `--shard=k/n` value as {k, n}; null when it is not one (1 ≤ k ≤ n).
export function parseShard(v: string): { k: number; n: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(v);
  if (!m) return null;
  const k = Number(m[1]), n = Number(m[2]);
  return k >= 1 && k <= n ? { k, n } : null;
}
